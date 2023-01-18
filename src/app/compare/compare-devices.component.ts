import { Component } from '@angular/core'
import { Prompts } from 'ack-angular';
import { DirectoryManager } from 'ack-angular-components/directory-managers/DirectoryManagers';
import { Actions, Device, ProfileAction, ProfileFolderManifest } from '../elgato.types';
import { SessionProvider } from '../session.provider';
import { getProfileHomeDirByDir, ProfileFolderManifestRead, ProfileManifestRead, StreamDeck } from '../StreamDeck.class';
import { NotInActionsCompare, NotInProfileCompare } from './compare-types';
import { deleteProfileAction, DeviceView, getChildByAction, getDeviceView } from './navigate-devices.component';

const noCompareSettings = [
  'com.elgato.streamdeck.profile.openchild',
  'com.elgato.streamdeck.profile.backtoparent',
  'com.elgato.streamdeck.profile.rotate',
]

@Component({
  templateUrl: './compare-devices.component.html',
})
export class CompareDevicesComponent {
  compared = false
  
  deviceFrom?: Device
  fromProfiles: ProfileManifestRead[] = []
  
  deviceWith?: Device
  withProfiles: ProfileManifestRead[] = []
  
  devices: Device[] = []
  
  // comparison: Compare[] = []
  notFoundProfiles: NotInProfileCompare[] = []
  notFoundActions: NotInActionsCompare[] = []

  showOtherStreamDeck = false
  otherDevices: Device[] = []
  otherStreamDeck: StreamDeck

  // modal control to show sub folder select
  actionNoSubFolder?: {
    action: ProfileAction
    deviceView: DeviceView
    missingFolderAction: MissingFolderAction
    missingFolderActions: MissingFolderAction[]
  }

  constructor(
    public session: SessionProvider,
    public prompts: Prompts,
  ) {
    if ( session.streamdeck.dir ) {
      this.setDirectory(session.streamdeck.dir)
    }

    this.otherStreamDeck = new StreamDeck(session)
  }

  async setOtherDirectory(dir: DirectoryManager) {
    this.otherStreamDeck.dir = dir
    this.compared = false
    ++this.session.loading
    this.otherDevices = await this.otherStreamDeck.fetchDevices()
    --this.session.loading
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
    const devices = this.showOtherStreamDeck ? this.otherDevices : this.devices
    this.deviceWith = devices.find(x => x.UUID === uuid)
  }

  async compare() {
    this.compared = false
    if ( !this.deviceFrom || !this.deviceWith ) {
      throw new Error('deviceFrom or deviceWith are not defined')
    }

    this.notFoundProfiles.length = 0
    this.notFoundActions.length = 0

    ++this.session.loading
    this.fromProfiles = await this.session.streamdeck.getProfileFoldersByDeviceId(this.deviceFrom.UUID)
    
    const otherDeck = this.showOtherStreamDeck ? this.otherStreamDeck : this.session.streamdeck
    this.withProfiles = await otherDeck.getProfileFoldersByDeviceId(this.deviceWith.UUID)

    this.session.info('scanning for missing profiles')
    await this.findMissingProfiles(this.fromProfiles, this.withProfiles, this.notFoundProfiles)
    this.session.info('scanning for missing actions')
    await this.findMissingActions(this.fromProfiles, this.withProfiles, this.notFoundActions)
    --this.session.loading
    this.compared = true
  }

  findMissingProfiles(
    fromProfiles: ProfileManifestRead[],
    withProfiles: ProfileManifestRead[],
    results: NotInProfileCompare[] = [],
  ): NotInProfileCompare[] {
    const noMatchesFrom = this.findMissingProfilesByMode(fromProfiles, withProfiles, 'not-in-with')
    const noMatchesWith = this.findMissingProfilesByMode(withProfiles, fromProfiles, 'not-in-from')
    results.push(...noMatchesFrom)
    results.push(...noMatchesWith)
    return results
  }

  async findMissingActions(
    fromProfiles: ProfileManifestRead[],
    withProfiles: ProfileManifestRead[],
    results: NotInActionsCompare[] = [],
  ): Promise<NotInActionsCompare[]> {
    await this.findMissingActionsByMode(fromProfiles, withProfiles, 'not-in-with', results)
    // Currently, we only scan in one direction
    // await this.findMissingActionsByMode(withProfiles, fromProfiles, 'not-in-from', results)
    return results
  }

  async findMissingActionsByMode(
    fromProfiles: ProfileManifestRead[],
    withProfiles: ProfileManifestRead[],
    compareType: 'not-in-from' | 'not-in-with',
    results: NotInActionsCompare[] = [],
  ): Promise<NotInActionsCompare[]> {
    const promises = fromProfiles.map(async fromProfile => {
      const withProfile = findProfileNameMatch(fromProfile, withProfiles)

      if ( !withProfile ) {
        return // its not even a found profile, skip
      }

      const [fromProfileHomeDir, withProfileHomeDir] = await Promise.all([
        getProfileHomeDirByDir(fromProfile.manifestFile.directory, fromProfile),
        getProfileHomeDirByDir(withProfile.manifestFile.directory, withProfile),
      ])

      if ( !fromProfileHomeDir ) {
        console.warn('cannot find home page for fromProfileHomeDir')
        return
      }

      if ( !withProfileHomeDir ) {
        console.warn('cannot find home page for withProfileHomeDir')
        return
      }

      const compared = await compareProfileFolders(
        fromProfileHomeDir,
        withProfileHomeDir,
        compareType,
        { fromProfile, withProfile },
        results
      )
      
      return compared
    })

    await Promise.all(promises)
    return results
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
    
    // write new json file
    const newManifest = JSON.stringify(manifest, null, 2)
    await compare.notInActions.notInFile.write(newManifest)
    delete compare.notInActions.actions[key]

    // copy image
    const imagePath = action.States[0].Image
    const imagePathSplit = imagePath.split('/')
    const imageFolder = imagePathSplit[0]
    const imageFileName = imagePathSplit[1]
    const imgDir = await compare.notInActions.fromProfileDir.getDirectory(imageFolder)
    const file = await imgDir.file(imageFileName)
    const base64 = await file.readAsDataURL()
    const blob = dataURItoBlob(base64)
    // write copied image
    const notInFile = compare.notInActions.notInFile
    const writeDir = await notInFile.directory.getDirectory(imageFolder)
    const writeFile = await writeDir.file(imageFileName, { create: true })
    await writeFile.write(blob as any)
    
    this.session.info(`Successfully saved ${notInFile.directory.path}/${notInFile.name}`)
  }

  async showSubFolderSelect(
    profile: ProfileManifestRead,
    missing: MissingFolderAction,
    device: Device,
    streamdeck: StreamDeck,
    missingFolderActions: MissingFolderAction[]
  ) {
    const pfmr: ProfileFolderManifestRead = {
      manifestFile: profile.manifestFile,
      dir: profile.dir,
      manifest: missing.profileFolder,
      profile,
    }

    this.actionNoSubFolder = {
      action: missing.action,
      deviceView: await getDeviceView(device, streamdeck, { profile: pfmr }),
      missingFolderAction: missing,
      missingFolderActions,
    }
  }

  noActionSuccess() {
    console.log(0)
    if ( !this.actionNoSubFolder ) {
      return
    }
    
    const matchWith = this.actionNoSubFolder.missingFolderAction
    removeMissingAction(matchWith, this.actionNoSubFolder.missingFolderActions)
  }

  async deleteMissingAction(
    missing: MissingFolderAction,
    missingFrom: MissingFolderAction[]
  ) {
    if ( !this.prompts.confirm('Confirm delete action') ) {
      return
    }

    await deleteProfileAction(missing.action, missing.profileFolderRead)
    removeMissingAction(missing, missingFrom)
  }
}

function removeMissingAction(
  matchWith: MissingFolderAction,
  missingFolderActions: MissingFolderAction[],
) {
  const index = missingFolderActions.findIndex(x => x === matchWith)
  missingFolderActions.splice(index, 1)
}

function findProfileNameMatch(
  fromProfile: ProfileManifestRead,
  withProfiles: ProfileManifestRead[]
) {
  return withProfiles.find(withProfile =>
    withProfile.manifest.Name === fromProfile.manifest.Name
  )
}

async function compareProfileActionForKids(
  fromAction: ProfileAction,
  fromFolder: ProfileFolderManifestRead,
  withAction: ProfileAction,
  withFolder: ProfileFolderManifestRead,
  compareType: 'not-in-from' | 'not-in-with',
  {fromProfile, withProfile}: {
    fromProfile: ProfileManifestRead
    withProfile: ProfileManifestRead
  },
): Promise<NotInActionsCompare[]> {
  if ( fromAction.UUID !== 'com.elgato.streamdeck.profile.openchild' ) {
    return [] // not interested, we only want folders
  }
  
  const fromChild = await getChildByAction(fromAction, fromFolder)
  if ( !fromChild ) {
    fromProfile.missingFolderActions.push({
      action: fromAction,
      dir: fromFolder.dir,
      profileFolder: fromFolder.manifest,
      profileFolderRead: fromFolder,
    })
    console.warn('🟠 Cannot find the from child folder by action', fromAction.States[0].Title, fromAction)
    // TODO: find a way to notate that
    return [] // cannot find child so we can't continue
  }
  
  const withChild = await getChildByAction(withAction, withFolder)
  if ( !withChild ) {
    withFolder.profile.missingFolderActions.push({
      action: withAction,
      dir: withFolder.dir,
      profileFolder: withFolder.manifest,
      profileFolderRead: withFolder
    })

    console.warn('🟠 Cannot find the with child folder by action', withAction.States[0].Title, withAction)
    // TODO: find a way to notate that
    return []// cannot find child so we can't continue
  }

  // find missing actions between two folders
  const results = await compareProfileFolders(
    fromChild.folder,
    withChild.folder, 
    compareType,
    { fromProfile , withProfile }, // aka profileParent
  )

  return results
}

async function compareProfileFolders(
  fromFolder: ProfileFolderManifestRead,
  withFolder: ProfileFolderManifestRead,
  compareType: 'not-in-from' | 'not-in-with',
  { fromProfile, withProfile }: {
    fromProfile: ProfileManifestRead
    withProfile: ProfileManifestRead
  },
  results: NotInActionsCompare[] = [],
): Promise<NotInActionsCompare[]> {
  const fromActions = fromFolder.manifest.Controllers[0].Actions
  const withActions = withFolder.manifest.Controllers[0].Actions

  const promises = Object.entries(fromActions).map(async ([key, action]) => {
    const withAction: ProfileAction = withActions[key]

    if ( withAction ) {
      const kidResults = await compareProfileActionForKids(
        action,
        fromFolder,
        withAction,
        withFolder,
        compareType,
        {withProfile, fromProfile},
      )
      results.push(...kidResults)

      const isMisaligned = Object.entries(action.Settings).find(([name, value]) => {
        if ( noCompareSettings.includes(action.UUID) ) {
          return false // we can't compare settings for this kind
        }

        if ( !['string','number','boolean'].includes(typeof(value)) ) {
          return false // we only compare simple values
        }

        const compareValue = (withAction.Settings as any)[name]
        if ( compareValue !== value ) {
          return true // a simple value is not the same on both sides
        }

        return false // its the right value
      })

      if ( isMisaligned ) {
        return {
          key, // the button position
          action,
        }
      }

      return false // the action was found, skip it
    }

    return {
      key, // the button position
      action,
    }
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
      
      fromProfileDir: fromFolder.dir, // the directory we are coming FROM so we can grab images
      withProfileDir: withFolder.dir, // the directory we need to paste things into
      
      // missing in profile parent details
      fromProfile, 

      // ui elements
      viewFromJson: {}
    }
  }

  if ( Object.keys(result.notInActions.actions).length ) {
    results.push(result)
  }

  return results
}

function dataURItoBlob(dataURI: string) {
  const byteString = atob(dataURI.split(',')[1]);
  const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0]
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([ab], {type: mimeString});
  return blob;
}

export interface MissingFolderAction {
  profileFolder: ProfileFolderManifest
  profileFolderRead: ProfileFolderManifestRead
  action: ProfileAction
  dir: DirectoryManager
}
