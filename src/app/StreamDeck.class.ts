import { DirectoryManager, DmFileReader } from "ack-angular-components/directory-managers/DirectoryManagers"
import { Device, DeviceProfile, ProfileFolderManifest } from "./elgato.types"
import { SessionProvider } from "./session.provider"

export interface ProfileFolderManifestRead {
  manifest: ProfileFolderManifest
  manifestFile: DmFileReader
  dir: DirectoryManager
  deviceRead: ProfileManifestRead
}

export class StreamDeck {
  dir?: DirectoryManager

  constructor(public session: SessionProvider) {}

  async getProfileHomeDirByDeviceId(deviceId: string): Promise<ProfileFolderManifestRead | undefined> {
    const results = await this.eachProfileFolderByDeviceId(deviceId, async (read) => {
      if ( read.manifest.Name==='Default Profile' ) {
        return await getProfileHomeDirByDir(read.dir, read)
      }

      const profilesDir = await read.dir.getDirectory('Profiles')
      const folders = await profilesDir.getFolders()
      
      const promises = folders.map(async folder => {
        const controlFile = await folder.findFileByPath('manifest.json')
        if ( !controlFile ) {
          return
        }
  
        const controlManifest: ProfileFolderManifest = (await controlFile.readAsJson()) as ProfileFolderManifest
        const hasProfileSwitch = controlManifest.Controllers.find(control => {
          return Object.entries(control.Actions).find(([key, action]) => {
            if ( key === "0,0" && action.UUID === 'com.elgato.streamdeck.profile.rotate' ) {
              return true
            }
            // action.UUID === 'com.elgato.streamdeck.profile.rotate'
            return action.UUID === 'com.elgato.streamdeck.profile.backtoparent'
          })
        })
  
        if ( hasProfileSwitch ) {
          return // its a sub profile and not a root
        }
  
        const result: ProfileFolderManifestRead = {
          manifest: controlManifest,
          manifestFile: controlFile,
          dir: read.dir,
          deviceRead: read,
        }
        return result
      })

      const results = await Promise.all(promises)
      return results.find(x => x)
    })

    return results.find(x => x)
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

  async eachProfileFolderByDeviceId<EachReturn>(
    deviceId: string, // uuid
    eachProfileFolder: (profileManifestRead: ProfileManifestRead) => Promise<EachReturn>
  ): Promise<EachReturn[]> {
    const results = await this.eachProfileFolder(async (folder, parent) => {
      const manifestFile = await folder.findFileByPath('manifest.json')
    
      if ( !manifestFile ) {
        return
      }

      const manifest = await manifestFile.readAsJson() as DeviceProfile
  
      if ( deviceId !== manifest.Device.UUID ) {
        return // not a device we care about
      }

      return eachProfileFolder({
        manifest, manifestFile, dir: folder,
      })
    })

    return results.filter(v => v) as EachReturn[]
  }

  async eachProfileFolder<EachReturn>(
    eachProfileFolder: (folder: DirectoryManager, parentDir: DirectoryManager) => Promise<EachReturn>
  ): Promise<EachReturn[]> {
    if ( !this.dir ) {
      throw new Error('StreamDeck folder not set')
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
    const firstControl = json.Controllers[0]
    const actions = firstControl.Actions
    const backAction = Object.values(actions).find(action => {  
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
