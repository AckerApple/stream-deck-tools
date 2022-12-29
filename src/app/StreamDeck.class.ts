import { DirectoryManager, DmFileReader } from "ack-angular-components/directory-managers/DirectoryManagers"
import { Actions, Device, DeviceProfile, ProfileAction, ProfileFolderManifest } from "./elgato.types"
import { SessionProvider } from "./session.provider"

export interface ProfileFolderManifestRead {
  manifestFile: DmFileReader
  dir: DirectoryManager
  manifest: ProfileFolderManifest
  deviceRead: ProfileManifestRead
}

export class StreamDeck {
  dir?: DirectoryManager

  constructor(public session: SessionProvider) {}

  async getProfileHomeByDirName(dirname: string) {
    if ( !this.dir ) {
      return this.throwNotSet()
    }

    const dir = await this.dir.getDirectory(`ProfilesV2/${dirname}`)
    const profileManifestRead = await getProfileManifestReadByFolder(dir)
    if ( !profileManifestRead ) {
      return
    }
    
    return getProfileHomeDirByDir(dir, profileManifestRead)

  }

  getProfileHomeById(
    uuid: string
  ): Promise<ProfileFolderManifestRead | undefined> {
    const dirname = `${uuid}.sdProfile`
    return this.getProfileHomeByDirName(dirname)
  }

  async getProfileHomeDirByDeviceId(deviceId: string): Promise<ProfileFolderManifestRead | undefined> {
    const results = await this.eachProfileFolderByDeviceId(deviceId, async read => {
      if ( read.manifest.Name==='Default Profile' ) {
        return await getProfileHomeDirByDir(read.dir, read)
      }

      return this.guessProfileHomeDir(read)
    })

    return results.find(x => x)
  }

  async guessProfileHomeDir(
    read: ProfileManifestRead
  ): Promise<ProfileFolderManifestRead> {
    const folders = await getFoldersInProfileDir(read)
    
    const promises = folders.map(async dirRead => {
      const isChildLike = isProfileFolderManifestChildLike(dirRead.manifest)
      if ( isChildLike ) {
        return // its a sub profile and not a root
      }

      const result: ProfileFolderManifestRead = {
        ...dirRead,
        deviceRead: read,
      }
      return result
    })

    const results = await Promise.all(promises)

    return results.find(x => x) as ProfileFolderManifestRead
  }

  async fetchDevices() {
    const allDevices = await this.eachProfileFolder((profileFolder) =>
      listDeviceInFolder(profileFolder)
    )

    return allDevices.reduce((all, now) => {
      if ( !now || !all.find(x => x.UUID === now.UUID) ) {
        all.push(now as Device)
      }
      return all
    }, [] as Device[])
  }

  async getProfileFoldersByDeviceId(
    deviceId: string, // uuid
  ): Promise<ProfileManifestRead[]> {
    const results = await this.eachProfileFolder(async (folder, parent) => {
      const profileManifestRead = await getProfileManifestReadByFolder(folder)

      if ( !profileManifestRead || deviceId !== profileManifestRead.manifest.Device.UUID ) {
        return // not a device we care about
      }

      return profileManifestRead
    })

    return results.filter(v => v) as ProfileManifestRead[]
  }

  async eachProfileFolderByDeviceId<EachReturn>(
    deviceId: string, // uuid
    eachProfileFolder: (profileManifestRead: ProfileManifestRead) => Promise<EachReturn>
  ): Promise<EachReturn[]> {
    const reads = await this.getProfileFoldersByDeviceId(deviceId)
    const promises = reads.map(profileManifestRead => eachProfileFolder(profileManifestRead))
    const mapped = await Promise.all(promises)
    return mapped.filter(v => v) as EachReturn[]
  }

  throwNotSet(): never {
    throw new Error('StreamDeck folder not set')
  }

  async eachProfileFolder<EachReturn>(
    eachProfileFolder: (folder: DirectoryManager, parentDir: DirectoryManager) => Promise<EachReturn>
  ): Promise<EachReturn[]> {
    if ( !this.dir ) {
      return this.throwNotSet()
    }

    ++this.session.loading
    const profilesV2 = await this.dir.getDirectory('ProfilesV2')
    
    // get profiles folders
    const folders = await profilesV2.getFolders()
    const targetFolders = await Promise.all( folders.map(manifestFolderOnly) )
    const dirs = targetFolders.filter(folder => folder) as DirectoryManager[]
    
    // loop profile folders
    const inspectedFolders = dirs.map(profileFolder => eachProfileFolder(profileFolder, profilesV2))

    const actions = await Promise.all(inspectedFolders)
    --this.session.loading
    return actions
  }

}

async function listDeviceInFolder(folder: DirectoryManager): Promise<Device | undefined> {
  const manifestFile = await folder.findFileByPath('manifest.json')

  if ( !manifestFile ) {
    return
  }

  const json = await manifestFile.readAsJson() as DeviceProfile
  return json.Device as Device
}

// a function to reduce folders down to only ones containing a manifest.json file
export async function manifestFolderOnly(folder: DirectoryManager): Promise<DirectoryManager | undefined> {
  const file = await folder.findFileByPath('manifest.json')

  if ( file ) {
    return folder
  }
  
  return undefined
}

export interface ProfileManifestRead {
  manifest: DeviceProfile
  manifestFile: DmFileReader
  dir: DirectoryManager
}


export async function getProfileHomeDirByDir(
  dir: DirectoryManager,
  profileManifestRead: ProfileManifestRead
): Promise<ProfileFolderManifestRead | undefined> {
  const profilesDir = await dir.getDirectory('Profiles')
  const folders = await profilesDir.getFolders()
  const results = folders.map(async folder => {
    const manifestFile = await folder.findFileByPath('manifest.json')
    
    if ( !manifestFile ) {
      return
    }
    
    const json = await manifestFile.readAsJson() as ProfileFolderManifest

    if ( !json.Controllers ) {
      const err = new Error(`File ${manifestFile.name} appears to have in invalid format. Path:${folder.path}`)
      console.error(err, json)
      throw err
      return
    }

    const firstControl = json.Controllers[0]
    const actions = firstControl.Actions
    const actionArray: ProfileAction[] = Object.values(actions)
    const backAction = actionArray.find((action) => {  
      if ( action.UUID !== 'com.elgato.streamdeck.profile.backtoparent' ) {
        return // not a back action, not interested
      }
      return action
    })

    if ( backAction ) {
      return // it has a back to parent so it can't be our target
    }

    const result: ProfileFolderManifestRead = {
      manifest: json, manifestFile, dir: folder,
      deviceRead: profileManifestRead,
    }

    return result
  })

  const folder = (await Promise.all(results)).find(x => x)
  return folder
}

async function getProfileManifestReadByFolder(folder: DirectoryManager) {
  const manifestFile = await folder.findFileByPath('manifest.json')
  if ( !manifestFile ) {
    return
  }

  const manifest = await manifestFile.readAsJson() as DeviceProfile
  const profileManifestRead: ProfileManifestRead = {
    manifest, manifestFile, dir: folder,
  }

  return profileManifestRead
}

export function firstBackToParentAction(actions: Actions) {
  return Object.values(actions).find(action => action.UUID === 'com.elgato.streamdeck.profile.backtoparent')
}

export function onlyActionsBackToParent(actions: Actions) {
  return Object.values(actions).filter(action => action.UUID === 'com.elgato.streamdeck.profile.backtoparent')
}

export function onlyActionsToChildren(actions: Actions) {
  return Object.values(actions).filter(action => action.UUID === 'com.elgato.streamdeck.profile.openchild')
}

export async function getChildFoldersInProfileDir(
  deviceRead: ProfileManifestRead
) {
  const results = await getFoldersInProfileDir(deviceRead)
  return results.filter(x => isProfileFolderManifestChildLike(x.manifest))
}

export async function getFoldersInProfileDir(
  deviceRead: ProfileManifestRead,
  excludePath?: string
): Promise<ProfileFolderManifestRead[]> {
  const dir = deviceRead.dir
  const profilesDir = await dir.getDirectory('Profiles')
  const folders = await profilesDir.getFolders()
  const promises = folders.map(async folder => {
    const manifestFile = await folder.findFileByPath('manifest.json')
    if ( !manifestFile ) {
      return
    }

    const manifest: ProfileFolderManifest = (await manifestFile.readAsJson()) as ProfileFolderManifest
    const result: ProfileFolderManifestRead = {
      manifestFile,
      dir: folder,
      manifest,
      deviceRead,
    }

    return result
  })
  
  const results = await Promise.all(promises)
  let limitedResults = results.filter(x => x) as ProfileFolderManifestRead[]
  
  if ( excludePath ) {
    limitedResults = limitedResults.filter(x => x.dir.path != excludePath)
  }
  
  return limitedResults
}

function isProfileFolderManifestChildLike(
  profile: ProfileFolderManifest
): boolean {
  const result = profile.Controllers.find(control => {
    return Object.entries(control.Actions).find(([key, action]) => {
      // check if first position is to rotate
      if ( key === "0,0" && action.UUID === 'com.elgato.streamdeck.profile.rotate' ) {
        return true
      }

      // check if subfolder
      return action.UUID === 'com.elgato.streamdeck.profile.backtoparent'
    })
  })

  return result ? true : false
}