import { Component } from '@angular/core'
import { DirectoryManager, DmFileReader } from 'ack-angular-components/directory-managers/DirectoryManagers'

interface DeviceProfile {
  Device: Device
  Name: string
  Pages: {
    Current: string
    Pages: string[]
  },
  Version: string
}


interface Profile {
  Controllers: {
    Actions: {
      [position: string]: ProfileAction
    }
  }[]
}

interface ProfileAction {
  Name: string
  Settings: {
    ProfileUUID: string
  }
  States: { Image: string }[]
}

interface Device {
  Model:string
  UUID:string
}

interface BadAction {
  fixProfile: string // where is should point to
  profile: Profile
  file: DmFileReader // The file with the bad switch
  device: Device // The device with the bad switch
  action: ProfileAction // The bad instructions
  targetProfileName: string // What is attempting to be referenced
  badTargetUuid: string // what illegal target are we pointing at
  badProfileUuid: string // The owner of the bad action
  badProfileName: string // The owner of the bad action
}

@Component({
  templateUrl: './fix-profiles-nav.component.html',
})
export class FixProfilesNavComponent {
  streamDeckDir?: DirectoryManager

  async setDirectory(dir: DirectoryManager) {
    const profilesV2 = await dir.getDirectory('ProfilesV2')
    
    // get profiles folders
    const folders = await profilesV2.getFolders()
    const targetFolders = await Promise.all( folders.map(manifestFolderOnly) )
    const dirs = targetFolders.filter(folder => folder) as DirectoryManager[]
    
    // loop profile folders
    const inspectedFolders = dirs.map(profileFolder => this.inspectProfileFolders(profileFolder, profilesV2))
    const badActions = (await Promise.all(inspectedFolders))
      .reduce((all, now) => {
        all.push(...now)
        return all
      },[])

    console.log('badActions', badActions)
    await Promise.all( this.fixBadActions(badActions) )
    console.log('fixedActions', badActions)
  }

  fixBadActions(badActions: BadAction[]) {
    return badActions.map(badAction => {
      badAction.action.Settings.ProfileUUID = badAction.fixProfile
      const write = JSON.stringify(badAction.profile, null, 2)
      return badAction.file.write(write)
    })
  }

  async inspectProfileFolders(
    profileFolder: DirectoryManager,
    profilesV2: DirectoryManager
  ): Promise<BadAction[]> {
    const profileManifestFile = await profileFolder.file('manifest.json')
    const profileManifest = await profileManifestFile.readAsJson() as DeviceProfile
          
    // Get the folder that contains all button panels for a profile
    const profiles = await profileFolder.getDirectory('Profiles')
    const folders = await profiles.getFolders()
    const targetFolders = await Promise.all( folders.map(manifestFolderOnly) )
    const dirs = targetFolders.filter(folder => folder) as DirectoryManager[]

    // loop single profile folders
    const inspectedFolders = dirs.map(dir => this.inspectProfileFolder(dir, {profilesV2, profileManifest, profileFolder}))
    const badActions: BadAction[] = (await Promise.all(inspectedFolders))
      .reduce((all, now) => {
        all.push(...now)
        return all
      },[])

    return badActions
  }

  async inspectProfileFolder(
    dir: DirectoryManager,
    {profilesV2, profileManifest, profileFolder}: {
      profileManifest: DeviceProfile
      profilesV2: DirectoryManager
      profileFolder: DirectoryManager
    }
  ): Promise<BadAction[]> {
    const manifest = await dir.file('manifest.json')
    const profile = await manifest.readAsJson() as Profile
    const actions = Object.values(profile.Controllers[0].Actions)

    // loop each action and diagnosis
    const inspectedActions = actions.map( action => this.inspectAction(action, {
      profile,
      profileManifest,
      device: profileManifest.Device,
      profilesV2,
      profileFolder,
      manifest
    }))

    return (await Promise.all(inspectedActions)).filter(x => x) as BadAction[]
  }

  async inspectAction(
    action: ProfileAction,
    {device, manifest, profilesV2, profileManifest, profileFolder, profile}: {
      profile: Profile
      device: Device
      profileManifest: DeviceProfile
      manifest: DmFileReader
      profilesV2: DirectoryManager
      profileFolder: DirectoryManager
    }
  ): Promise<BadAction | undefined> {
    if ( action.Name !== 'Switch Profile' ) {
      return // not an action we are interested in
    }

    // record the device model of current profile. We will eventually check if it matches Switch Profiles
    const model = device.Model
    const uuid = device.UUID

    const targetProfile = action.Settings.ProfileUUID // where it points to
    const targetManifestFile = await this.getManifestFileByProfileUuid(targetProfile, profilesV2)

    const badActionPrep = {
      action, file: manifest, device, profile,
      badTargetUuid: targetProfile,
      badProfileUuid: profileFolder.path.split('/').pop()?.split('.').shift() as string,
      badProfileName: profileManifest.Name,
    }

    if ( !targetManifestFile ) {
      console.log('cant find manifest.json in ' + targetProfile + '')
      
      const fixByImage = await this.findSwitchFixByActionImageCompare(action, device, profilesV2)
      if ( !fixByImage ) {
        return
      }

      return {
        ...badActionPrep,
        targetProfileName: fixByImage.targetProfileName,
        fixProfile: fixByImage.fixProfile,
      }
    }

    const targetManifest = await targetManifestFile.readAsJson() as any
    const targetModel = targetManifest.Device.Model

    // does the current device match the referenced profile device? If not we need to repair
    if ( targetModel === model && targetManifest.Device.UUID === uuid ) {
      return // its a good reference, no need to continue
    }

    // can we find a fix?
    const fix = await this.findSwitchFixByDeviceInFolder(action, profileManifest.Device, profilesV2)

    if ( !fix ) {
      return
    }

    const badAction: BadAction = {
      ...badActionPrep,
      targetProfileName: targetManifest.Name,
      fixProfile: fix,
    }

    return badAction
  }

  async getManifestFileByProfileUuid(
    targetProfile: string,
    profilesV2: DirectoryManager
  ): Promise<DmFileReader | undefined> {
    const dirName = targetProfile + '.sdProfile'
    try {
      const targetProfileFolder = await profilesV2.getDirectory(dirName)
      const manifest = await targetProfileFolder.findFileByPath('manifest.json')
      return manifest
    } catch(err) {
      console.warn(`could not read dir ${dirName}`, err)
      return
    }
  }

  /** Looks for a correcting profile uuid for a switch action
   * 1. Records the associated images and loads all profile actions
   * 2. Loads every profile action looking for a Switch Profile with same images
   * 3. Records the name of the profile that is for another device
   * 3. Reads all possible folders looking for a matching profile by name of same device
   * 4. Returns folder name without `.sdProfile` to be used as replacement
  */
  async findSwitchFixByActionImageCompare(
    action: ProfileAction,
    device: Device,
    profilesV2: DirectoryManager
  ): Promise<{fixProfile:string, targetProfileName:string} | undefined> {
    // 1.
    const states = action.States
    
    const profileFolders = (await profilesV2.getFolders()).filter( manifestFolderOnly )

    return await awaitFind(profileFolders, async folder => {
      const profilesFolder = await folder.getDirectory('Profiles')
      const profilesFolders = (await profilesFolder.getFolders()).filter( manifestFolderOnly )
      return await awaitFind(profilesFolders, async folder => {
        const profileFolderManifestFile = await folder.file('manifest.json')
        const profileFolderManifest = await profileFolderManifestFile.readAsJson() as Profile
        const actionsObject = profileFolderManifest.Controllers[0].Actions
        const actions = Object.values(actionsObject)
        return await awaitFind(actions,async action => {
            if ( !action.States || action.States.length !== states.length ) {
              return
            }

            const matches = action.States.filter((state, index) => state.Image === states[index].Image)
            
            if ( matches.length !== states.length ) {
              return // cant be our match
            }

            const uuid = action.Settings.ProfileUUID
            const targetManifestFile = await this.getManifestFileByProfileUuid(uuid, profilesV2)
            
            if ( !targetManifestFile ) {
              console.warn(`could not load a Switch Profile ${uuid}`)
              return
            }

            const targetManifest = await targetManifestFile.readAsJson() as DeviceProfile
            const newMatch = await this.matchProfileFolderByNameAndDevice(targetManifest.Name, device, profilesV2)

            if ( !newMatch ) {
              console.warn(`cannot find new match to target ${targetManifest.Name}`)
            }

            return {
              fixProfile: newMatch?.split('.').shift() as string,
              targetProfileName: targetManifest.Name
            }
          })
      })
    })
  }

  /** Looks for a correcting profile uuid for a switch action
   * 1. Takes the ProfileUUID and attempts load that profile if its for another device
   * 2. Records the name of the profile that is for another device
   * 3. Reads all possible folders looking for a matching profile by name of same device
   * 4. Returns folder name without `.sdProfile` to be used as replacement
  */
  async findSwitchFixByDeviceInFolder(
    action: ProfileAction,
    device: Device,
    profilesV2: DirectoryManager
  ): Promise<string | undefined> {
    // 1.
    const uuid = action.Settings.ProfileUUID
    const targetManifestFile = await this.getManifestFileByProfileUuid(uuid, profilesV2)
    
    if ( !targetManifestFile ) {
      console.warn('cannot load target manifest')
      return
    }
    
    const targetManifest = await targetManifestFile?.readAsJson() as DeviceProfile
    if ( targetManifest.Device.Model === device.Model && targetManifest.Device.UUID === device.UUID ) {
      return // its already valid
    }
    
    // 2.
    const targetProfileName = targetManifest.Name
    
    // 3.
    const correctFolderName = await this.matchProfileFolderByNameAndDevice(targetProfileName, device, profilesV2)

    if ( !correctFolderName ) {
      return
    }

    // 4.
    return correctFolderName.split('.').shift()
  }

  async matchProfileFolderByNameAndDevice(
    targetProfileName: string,
    device: Device,
    profilesV2: DirectoryManager
  ) {
    const folderNames = await profilesV2.listFolders()

    const all: (string | undefined)[] = await Promise.all( folderNames.map(async (name) => {
      const profileDir = await profilesV2.getDirectory(name)
      const manifestFile = await profileDir.findFileByPath('manifest.json')

      if ( !manifestFile ) {
        return
      }

      const manifest = await manifestFile.readAsJson() as DeviceProfile
      const modelMatch = manifest.Device.Model === device.Model
      const uuidMatch = manifest.Device.UUID === device.UUID
      const nameMatch = manifest.Name === targetProfileName

      if ( !nameMatch || !modelMatch || !uuidMatch ) {
        return
      }
      
      return name // return the folder name so it can be used as new Switch Profile uuid
    }) )

    return all.find(x => x) // return first valid
  }
}

// a function to reduce folders down to only ones containing a manifest.json file
async function manifestFolderOnly(folder: DirectoryManager): Promise<DirectoryManager | undefined> {
  const file = await folder.findFileByPath('manifest.json')
  if ( file ) {
    return folder
  }

  return undefined
}

async function awaitFind<T, G>(
  array: G[],
  method: (one: G, index: number) => T | undefined
): Promise<T | undefined> {
  const results = await Promise.all(array.map(method))
  return results.find(x => x)
}