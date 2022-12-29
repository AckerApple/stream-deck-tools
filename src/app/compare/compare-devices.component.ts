import { Component } from '@angular/core'
import { DirectoryManager, DmFileReader } from 'ack-angular-components/directory-managers/DirectoryManagers';
import { Actions, Device, DeviceProfile, ProfileAction, ProfileFolderManifest } from '../elgato.types';
import { SessionProvider } from '../session.provider';
import { getChildFoldersInProfileDir, getProfileHomeDirByDir, ProfileFolderManifestRead, ProfileManifestRead } from '../StreamDeck.class';
import { getChildByAction } from './navigate-devices.component';

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

    const fromProfiles = await this.session.streamdeck.getProfileFoldersByDeviceId(this.deviceFrom.UUID)
    const withProfiles = await this.session.streamdeck.getProfileFoldersByDeviceId(this.deviceWith.UUID)

    this.notFoundProfiles = this.findMissingProfiles(fromProfiles, withProfiles)
    this.notFoundActions = await this.findMissingActions(fromProfiles, withProfiles)
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
  ): Promise<NotInActionsCompare[]> {
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

      const results = await compareProfileFolders(fromProfileHomeDir, foundProfileHomeDir, fromProfile, compareType)
      
      return results
    })

    const results = await Promise.all(promises)
    const validResults = results.filter(x => x) as NotInActionsCompare[][]
    const flatResults = validResults.reduce((all, inner) => {
      all.push(...inner)
      return all
    }, [] as NotInActionsCompare[])
    return flatResults
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

  async fixNotFoundAction(
    key: string,
    action: ProfileAction,
    compare: NotInActionsCompare,
  ) {
    const notInActions = compare.notInActions
    const manifest = notInActions.manifest
    const placeInActions = manifest.Controllers[0].Actions
    compare.notInActions.actions
    placeInActions[ key ] = action
    const newManifest = JSON.stringify(manifest, null, 2)
    await compare.notInActions.notInFile.write(newManifest)
    delete compare.notInActions.actions[key]
  }
}

interface NotInProfileCompare extends Compare {
  itemType: 'profile'
  notInProfile: NotInProfile
}

interface NotInActions {
  notInFile: DmFileReader // manifest file missing control.action
  manifest: ProfileFolderManifest // manifest missing control.action

  actions: Actions
  inProfileDir: DirectoryManager // the directory we are coming FROM so we can grab images
  
  // missing in profile parent details
  profileParent: ProfileManifestRead
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

async function compareProfileActionForKids(
  fromAction: ProfileAction,
  fromFolder: ProfileFolderManifestRead,
  withAction: ProfileAction,
  withFolder: ProfileFolderManifestRead,
  profileParent: ProfileManifestRead,
  compareType: 'not-in-from' | 'not-in-with'
): Promise<NotInActionsCompare[]> {
  if ( fromAction.UUID !== 'com.elgato.streamdeck.profile.openchild' ) {
    return [] // not interested
  }
  
  const fromChild = await getChildByAction(fromAction, fromFolder)
  if ( !fromChild ) {
    // TODO: find a way to notate that
    return [] // cannot find child so we can't continue
  }
  
  const withChild = await getChildByAction(withAction, withFolder)
  if ( !withChild ) {
    // TODO: find a way to notate that
    return []// cannot find child so we can't continue
  }

  const results = await compareProfileFolders(
    fromChild.folder,
    withChild.folder, 
    profileParent,
    compareType
  )

  return results
}

async function compareProfileFolders(
  fromFolder: ProfileFolderManifestRead,
  withFolder: ProfileFolderManifestRead,
  profileParent: ProfileManifestRead,
  compareType: 'not-in-from' | 'not-in-with'
): Promise<NotInActionsCompare[]> {
  const results: NotInActionsCompare[] = []
  const fromActions = fromFolder.manifest.Controllers[0].Actions
  const withActions = withFolder.manifest.Controllers[0].Actions

  const promises = Object.entries(fromActions).map(async ([key, action]) => {
    const withAction = withActions[key]
    if ( withAction ) {
      const kidResults = await compareProfileActionForKids(
        action,
        fromFolder,
        withAction,
        withFolder,
        profileParent,
        compareType
      )
      results.push(...kidResults)
      return // the action was found, skip it
    }

    return { key, action }
  })
  const missingActions = (await Promise.all(promises)).filter(x => x) as {key:string, action:ProfileAction}[]

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

  if ( Object.keys(result.notInActions.actions).length ) {
    console.log('bad action push')
    results.push(result)
  }

  return results
}
