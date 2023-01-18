import { Component } from '@angular/core'
import { DirectoryManager, DmFileReader } from 'ack-angular-components/directory-managers/DirectoryManagers'
import { Actions, Device, DeviceProfile, ProfileAction, ProfileFolderManifest, State } from '../elgato.types'
import { SessionProvider } from '../session.provider'
import { manifestFolderOnly } from '../StreamDeck.class'

interface BadAction {
  profile: ProfileFolderManifest
  action: ProfileAction // The bad instructions
  device: Device // The device with the bad switch
  file: DmFileReader // The file with the bad switch
  dir: DirectoryManager // The file with the bad switch
  
  fixProfile: string // where is should point to
  targetProfileName: string // What is attempting to be referenced
  badTargetUuid: string // what illegal target are we pointing at
  badProfileUuid: string // The owner of the bad action
  badProfileName: string // The owner of the bad action
}

@Component({
  templateUrl: './fix-profiles-nav.component.html',
})
export class FixProfilesNavComponent {
  badActions: BadAction[] = []
  searched = false

  constructor(public session: SessionProvider) {}

  async load() {
    ++this.session.loading
    
    const actions = await this.session.streamdeck.eachProfileFolder((profileFolder, profilesV2) =>
    this.inspectProfileFolders(profileFolder, profilesV2)
    )
    const badActions: BadAction[] = actions
    .reduce((all, now) => {
      all.push(...now)
      return all
    },[])
    
    this.badActions = badActions
    this.searched = true
    --this.session.loading
  }
  
  async fixBadActions() {
    ++this.session.loading
    await Promise.all( this.fixByBadActions(this.badActions) )
    this.badActions.length = 0
    this.load()
    --this.session.loading
  }

  fixByBadActions(badActions: BadAction[]) {
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
    const profile = await manifest.readAsJson() as ProfileFolderManifest
    const controlActions = profile.Controllers[0].Actions
    const actions: ProfileAction[] = Object.values(controlActions)

    const meta: InspectActionMeta = {
      profile, dir,
      profileManifest,
      device: profileManifest.Device,
      profilesV2,
      profileFolder,
      manifest
    }

    // loop each action and diagnosis
    return this.inspectActions(actions, meta)
  }

  async inspectActions(
    actions: ProfileAction[],
    meta: InspectActionMeta
  ): Promise<BadAction[]> {
    const badActions: BadAction[] | undefined = []
    // let inspectedActions: Promise<BadAction | undefined>[] = []

    const inspectedActions = await Promise.all(
      actions.map(async action => {  
        if ( action.Actions ) {
          const newmeta = { ...meta }
          newmeta.rootAction = meta.rootAction || action
          const innerBadActions = await this.inspectActions(action.Actions, newmeta)
          badActions.push( ...innerBadActions )
        }
        
        return this.inspectAction(action, meta)
      })
    )
    
    badActions.push(...(await Promise.all(inspectedActions)).filter(x => x) as BadAction[])
    
    return badActions
  }

  async inspectAction(
    action: ProfileAction,
    {
      device, manifest, rootAction, dir,
      profilesV2, profileManifest, profileFolder, profile
    }: InspectActionMeta
  ): Promise<BadAction | undefined> {
    if ( action.Name !== 'Switch Profile' ) {
      return // not an action we are interested in
    }

    // record the device model of current profile. We will eventually check if it matches Switch Profiles
    const model = device.Model
    const uuid = device.UUID
    const targetProfile = action.Settings.ProfileUUID // where it points to
    const targetManifestFile = await getManifestFileByProfileUuid(targetProfile, profilesV2)

    const badActionPrep = {
      action, file: manifest, device, profile, dir,
      badTargetUuid: targetProfile,
      badProfileUuid: profileFolder.path.split('/').pop()?.split('.').shift() as string,
      badProfileName: profileManifest.Name,
    }

    const runFixByImageCompare = async () => {
      const fixByImage = await this.findSwitchFixByActionImageCompare(action, {device, profilesV2, rootAction: rootAction || action})
      if ( !fixByImage ) {
        return
      }

      const badAction: BadAction = {
        ...badActionPrep,
        targetProfileName: fixByImage.targetProfileName,
        fixProfile: fixByImage.fixProfile,
      }

      return badAction
    }

    if ( !targetManifestFile ) {
      console.log('cant find manifest.json in ' + targetProfile + '')
      return await runFixByImageCompare()
    }

    const targetManifest = await targetManifestFile.readAsJson() as any
    const targetModel = targetManifest.Device.Model

    // does the current device match the referenced profile device? If not we need to repair
    if ( targetModel === model && targetManifest.Device.UUID === uuid ) {
      const parentNameMatch = profileManifest.Name === targetManifest.Name
      const parentPath = profileFolder.path
      const parentProfileFolderId = parentPath.split('/').pop()?.split('.').shift() as string
      const profileIdsMatch = targetProfile.toLowerCase() === parentProfileFolderId.toLowerCase()
      const isSelfReferencing = parentNameMatch && profileIdsMatch
      
      // if this action just jumps to its owner profile, lets try by image compare
      if ( isSelfReferencing ) {
        const results = await runFixByImageCompare()
        return results
      }

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

  /** Looks for a correcting profile uuid for a switch action
   * 1. Records the associated images and loads all profile actions
   * 2. Loads every profile action looking for a Switch Profile with same images
   * 3. Records the name of the profile that is for another device
   * 3. Reads all possible folders looking for a matching profile by name of same device
   * 4. Returns folder name without `.sdProfile` to be used as replacement
  */
  async findSwitchFixByActionImageCompare(
    action: ProfileAction,
    {device, profilesV2, rootAction}: {
      device: Device,
      profilesV2: DirectoryManager,
      rootAction: ProfileAction
    }
  ): Promise<{fixProfile:string, targetProfileName:string} | undefined> {
    const states = rootAction.States    
    const folders = await profilesV2.getFolders()
    const manifestCheck = folders.map( manifestFolderOnly )
    const profileFolders = (await Promise.all(manifestCheck)).filter(x => x) as DirectoryManager[]

    const results =  await awaitFind(profileFolders, async (folder, index) => {
      const profilesFolder: DirectoryManager = await folder.getDirectory('Profiles')
      const profilesFolders = (await profilesFolder.getFolders()).filter( manifestFolderOnly )
      const results = await awaitFind(profilesFolders, x => this.imageScanProfileFolder(x, { states, profilesV2, action, device }))
      return results
    })

    return results
  }

  async imageScanProfileFolder(
    folder: DirectoryManager,
    { states, profilesV2, action, device }: {
      states: State[]
      profilesV2: DirectoryManager
      action: ProfileAction
      device: Device
    }
  ) {
    const profileFolderManifestFile = await folder.file('manifest.json')
    const profileFolderManifest = await profileFolderManifestFile.readAsJson() as ProfileFolderManifest
    const actionsObject: Actions = profileFolderManifest.Controllers[0].Actions

    const actions = Object.values(actionsObject)
      .filter(subaction => {
        const statesMatched = subaction.States.length === states.length

        if ( !statesMatched ) {
          return // can't be the one we want
        }
  
        const matches = subaction.States.filter((state, index) => state.Image === states[index].Image)
        // const matches2 = subaction.States.filter((state, index) => state.Image === rootAction.States[index].Image)
        const fullMatch = matches.length === states.length
  
        if ( !fullMatch ) {
          return // cant be our match
        }

        return subaction
      })

    const finds = await awaitFind(actions,async subaction => {
      return this.lookForSwitchAction(subaction, { states, profilesV2, action, device })
    })

    return finds
  }

  async lookForSwitchAction(
    subaction: ProfileAction,
    { states, profilesV2, action, device }: ImageHuntMeta
  ): Promise<undefined | {fixProfile: string, targetProfileName: string}> {
    if ( subaction.Actions ) {
      const subActionSwitchFind = await awaitFind(subaction.Actions, action => {
        return this.lookForSwitchAction(action, { states, profilesV2, action, device })
      })

      if ( subActionSwitchFind ) {
        return subActionSwitchFind
      }

      return 
    }

    if ( !subaction.Settings ) {
      return
    }
    
    const uuid = subaction.Settings.ProfileUUID
    if ( !uuid ) {
      return
    }

    const targetManifestFile = await getManifestFileByProfileUuid(uuid, profilesV2)
    
    if ( !targetManifestFile ) {
      console.warn(`could not load a Switch Profile ${uuid}`)
      return
    }

    const targetManifest = await targetManifestFile.readAsJson() as DeviceProfile
    const newMatch = await this.matchProfileFolderByNameAndDevice(targetManifest.Name, device, profilesV2)

    if ( !newMatch ) {
      console.warn(`cannot find new match to target ${targetManifest.Name}`)
      return
    }

    return {
      fixProfile: newMatch?.split('.').shift() as string,
      targetProfileName: targetManifest.Name
    }
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
    const targetManifestFile = await getManifestFileByProfileUuid(uuid, profilesV2)
    
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

async function awaitFind<T, G>(
  array: G[],
  method: (one: G, index: number) => T | undefined
): Promise<T | undefined> {
  const results = await Promise.all(array.map(method))
  return results.find(x => x)
}

interface InspectActionMeta {
  dir: DirectoryManager
  profile: ProfileFolderManifest
  device: Device
  profileManifest: DeviceProfile
  manifest: DmFileReader
  profilesV2: DirectoryManager
  profileFolder: DirectoryManager
  rootAction?: ProfileAction
}

interface ImageHuntMeta {
  action: ProfileAction
  states: State[]
  profilesV2: DirectoryManager
  device: Device
}


export async function getManifestFileByProfileUuid(
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
