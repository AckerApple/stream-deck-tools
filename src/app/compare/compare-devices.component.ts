import { Component } from '@angular/core'
import { DirectoryManager, DmFileReader } from 'ack-angular-components/directory-managers/DirectoryManagers';
import { Actions, Device, DeviceProfile, ProfileAction, ProfileFolderManifest } from '../elgato.types';
import { SessionProvider } from '../session.provider';
import { getProfileHomeDirByDir, ProfileFolderManifestRead, ProfileManifestRead } from '../StreamDeck.class';

interface Compare {
  compareType: 'not-in-from' | 'not-in-with'
  itemType: 'profile' | 'controlAction'

  // ❌ cannot be solved (we cant generate the folder ids elgato uses)
  notInProfile?: NotInProfile

  // ✅ can be solved. Existing profiles on both sides, just missing action
  notInActions?: NotInActions
}

interface NotInProfile {
  file: DmFileReader // existing manifest file
  manifest: DeviceProfile // existing manifest {Name: string}
}

interface NotInActions {
  notInFile: DmFileReader // manifest file missing control.action
  manifest: ProfileFolderManifest // manifest missing control.action

  actions: Actions
  inProfileDir: DirectoryManager // the directory we are coming FROM so we can grab images
  
  // missing in profile parent details
  profileParent: ProfileManifestRead
}

@Component({
  templateUrl: './compare-devices.component.html',
})
export class CompareDevicesComponent {
  compared = false
  deviceFrom?: Device
  deviceWith?: Device
  devices: Device[] = []
  // comparison: Compare[] = []
  notFoundProfiles: NotInProfileCompare[] = []
  notFoundActions: NotInActionsCompare[] = []

  constructor(public session: SessionProvider) {
    if ( session.streamdeck.dir ) {
      this.setDirectory(session.streamdeck.dir)
    }
  }

  async setDirectory(dir: DirectoryManager) {
    this.compared = false
    ++this.session.loading
    this.devices = await this.session.streamdeck.fetchDevices()
    --this.session.loading
  }

  setDeviceFrom(uuid: string) {
    this.deviceFrom = this.devices.find(x => x.UUID === uuid)
  }

  setDeviceWith(uuid: string) {
    this.deviceWith = this.devices.find(x => x.UUID === uuid)
  }

  async compare() {
    this.compared = false
    if ( !this.deviceFrom || !this.deviceWith ) {
      throw new Error('deviceFrom or deviceWith are not defined')
    }

    this.notFoundProfiles.length = 0
    const uuids = [this.deviceFrom.UUID, this.deviceWith.UUID]

    function getProfileFolderIterator(direction: 'from' | 'with') {
      return async (profileManifestRead: ProfileManifestRead) => {    
        return {
          type: direction,
          manifest: profileManifestRead.manifest,
          manifestFile: profileManifestRead.manifestFile,
          dir: profileManifestRead.dir,
        }
      }
    }

    const allFromProfiles = await this.session.streamdeck.eachProfileFolderByDeviceId(this.deviceFrom.UUID, getProfileFolderIterator('from'))
    const allWithProfiles = await this.session.streamdeck.eachProfileFolderByDeviceId(this.deviceWith.UUID, getProfileFolderIterator('with'))
    
    const allProfiles = [...allFromProfiles, ... allWithProfiles]

    const { fromProfiles, withProfiles } = allProfiles.reduce((all, now) => {
      if ( !now ) {
        return all // skip not wanted
      }

      if ( now.type === 'from' ) {
        all.fromProfiles.push({
          manifest: now.manifest,
          manifestFile: now.manifestFile,
          dir: now.dir,
        })
      } else {
        all.withProfiles.push({
          manifest: now.manifest,
          manifestFile: now.manifestFile,
          dir: now.dir,
        })
      }

      return all
    }, {
      fromProfiles: [], withProfiles: []
    } as {
      fromProfiles: ProfileManifestRead[],
      withProfiles: ProfileManifestRead[]
    })

    this.notFoundProfiles = this.findMissingProfiles(fromProfiles, withProfiles)
    this.notFoundActions = await this.findMissingActions(fromProfiles, withProfiles)
    console.log('this.notFoundProfiles', this.notFoundProfiles)
    console.log('this.notFoundActions', this.notFoundActions)
    this.compared = true
  }

  findMissingProfiles(
    fromProfiles: ProfileManifestRead[],
    withProfiles: ProfileManifestRead[]
  ): NotInProfileCompare[] {
    const noMatchesFrom = this.findMissingProfilesByMode(fromProfiles, withProfiles, 'not-in-with')
    const noMatchesWith = this.findMissingProfilesByMode(withProfiles, fromProfiles, 'not-in-from')
    noMatchesFrom.push(...noMatchesWith)
    return noMatchesFrom
  }

  async findMissingActions(
    fromProfiles: ProfileManifestRead[],
    withProfiles: ProfileManifestRead[]
  ): Promise<NotInActionsCompare[]> {
    const noMatchesFrom = await this.findMissingActionsByMode(fromProfiles, withProfiles, 'not-in-with')
    const noMatchesWith = await this.findMissingActionsByMode(withProfiles, fromProfiles, 'not-in-from')
    noMatchesFrom.push(...noMatchesWith)
    return noMatchesFrom
  }

  async findMissingActionsByMode(
    fromProfiles: ProfileManifestRead[],
    withProfiles: ProfileManifestRead[],
    compareType: 'not-in-from' | 'not-in-with'
  ): Promise<any> { // NotInActionsCompare[]
    const promises = fromProfiles.map(async fromProfile => {
      const foundProfile = findProfileNameMatch(fromProfile, withProfiles)

      if ( !foundProfile ) {
        return // its not even a found profile, skip
      }

      const fromProfileHomeDir = await getProfileHomeDirByDir(fromProfile.manifestFile.directory, fromProfile)
      const foundProfileHomeDir = await getProfileHomeDirByDir(foundProfile.manifestFile.directory, foundProfile)

      if ( !fromProfileHomeDir || !foundProfileHomeDir ) {
        console.warn('cannot find home page for fromProfileHomeDir and/or foundProfileHomeDir')
        return
      }

      const result = compareProfileFolders(fromProfileHomeDir, foundProfileHomeDir, fromProfile, compareType)

      if ( !Object.keys(result.notInActions.actions).length ) {
        return
      }

      return result
    })

    return (await Promise.all(promises)).filter(x => x)
  }

  findMissingProfilesByMode(
    fromProfiles: ProfileManifestRead[],
    withProfiles: ProfileManifestRead[],
    compareType: 'not-in-from' | 'not-in-with'
  ): NotInProfileCompare[] {
    return fromProfiles.filter(fromProfile => {
      const foundProfile = findProfileNameMatch(fromProfile,withProfiles)

      if ( foundProfile ) {
        return // its found we good
      }

      return fromProfile
    }).map(fromProfile => {
      const notInProfile: NotInProfileCompare = {
        itemType: 'profile',
        compareType,
        notInProfile: {
          file: fromProfile.manifestFile, // existing manifest file
          manifest: fromProfile.manifest // existing manifest {Name: string}        
        }
      }

      return notInProfile
    })
  }
}

interface NotInProfileCompare extends Compare {
  itemType: 'profile'
  notInProfile: NotInProfile
}

interface NotInActionsCompare extends Compare {
  itemType: 'controlAction'
  notInActions: NotInActions
}

function findProfileNameMatch(
  fromProfile: ProfileManifestRead,
  withProfiles: ProfileManifestRead[]
) {
  return withProfiles.find(withProfile => {
    return withProfile.manifest.Name === fromProfile.manifest.Name
  })
}

function compareProfileFolders(
  fromFolder: ProfileFolderManifestRead,
  withFolder: ProfileFolderManifestRead,
  profileParent: ProfileManifestRead,
  compareType: 'not-in-from' | 'not-in-with'
): NotInActionsCompare {
  const fromActions = fromFolder.manifest.Controllers[0].Actions
  const withActions = withFolder.manifest.Controllers[0].Actions

  const missingActions = Object.entries(fromActions).map(([key, action]) => {
    if ( withActions[key] ) {
      return // the action was found, skip it
    }

    return { key, action }
  }).filter(x => x) as {key:string, action:ProfileAction}[]

  const result: NotInActionsCompare = {
    compareType,
    itemType: 'controlAction',
    notInActions : {
      notInFile: withFolder.manifestFile, // manifest file missing control.action
      manifest: withFolder.manifest, // manifest missing control.action
    
      actions: missingActions.reduce((all, now) => {
        all[now.key] = now?.action
        return all
      }, {} as Actions),
      
      inProfileDir: fromFolder.dir, // the directory we are coming FROM so we can grab images
      
      // missing in profile parent details
      profileParent, 
    }
  }

  return result
}