import { Component } from '@angular/core'
import { Prompts } from 'ack-angular';
import { DirectoryManager } from 'ack-angular-components/directory-managers/DirectoryManagers';
import { Actions, Device, ProfileAction } from '../elgato.types';
import { SessionProvider } from '../session.provider';
import { getFoldersInProfileDir, onlyActionsToChildren, ProfileFolderManifestRead, ProfileManifestRead, StreamDeck } from '../StreamDeck.class';
import { getBackButtonsInFolder, SelectFolder } from './folder-action-match.component';
import { getDeviceViewButtonsByActions } from './page-buttons.component';

export interface DeviceView {
  device: Device
  gridLayout: GridLayout
  currentProfileName: string
  allProfiles: ProfileManifestRead[]
  currentProfile: ProfileFolderManifestRead

  lockNav: boolean // default true
  viewJson?: boolean
  action?: ProfileAction
}

@Component({
  templateUrl: './navigate-devices.component.html',
})
export class NavigateDevicesComponent {
  devices: Device[] = []
  deviceViews: DeviceView[] = []

  // modal control to show sub folder select
  actionNoSubFolder?: { action:ProfileAction, deviceView: DeviceView}

  constructor(
    public session: SessionProvider,
    public prompts: Prompts,
  ) {
    if ( session.streamdeck.dir ) {
      this.setDirectory(session.streamdeck.dir)
    }
  }

  async setDirectory(_dir: DirectoryManager) {
    ++this.session.loading
    this.devices = await this.session.streamdeck.fetchDevices()
    --this.session.loading
  }

  async addDevice(device: Device) {  
    const deviceView = await getDeviceView(device, this.session.streamdeck)
    this.deviceViews.push(deviceView)
  }

  async activateItem(
    action: ProfileAction,
    deviceView: DeviceView
  ) {
    switch (action.UUID) {
      case 'com.elgato.streamdeck.profile.openchild': // 'Create Folder'
        this.activateChildFolder(action, deviceView)
        break
      case 'com.elgato.streamdeck.profile.backtoparent': // 'Parent Folder'
        this.activateBackAction(action, deviceView)
        break

      case 'com.elgato.streamdeck.profile.rotate': // 'Switch Profile'
        this.activateSwitchProfile(action, deviceView)
        break
    
      default:
        console.warn(`unable to activate action of type ${action.Name}`)
    }
  }

  async activateBackAction(
    action: ProfileAction,
    deviceView: DeviceView,
  ) {
    const parentProfile = await getParentByBackAction(action, deviceView.currentProfile)
    if ( parentProfile ) {
      deviceView.currentProfile = {
        ...parentProfile.folder,
        profile: deviceView.currentProfile.profile
      }
    }
  }
  
  async activateChildFolder(
    action: ProfileAction,
    deviceView: DeviceView,
    { moveOtherViews = true, askUserForMatch = true } = {}
  ) {
    const related = await activateChildFolderByAction(action, deviceView)

    if ( related ) {
      if ( moveOtherViews ) {
        // ✅ we can navigate to the child
        // make a note of current parents before changing them
        const parentActions = deviceView.currentProfile.manifest.Controllers[0].Actions
        const parentDir = deviceView.currentProfile.dir

        this.moveOtherViewsByAction(action, parentActions, deviceView, parentDir)
      }

      return // no need to continue, we found where to go
    }

    if ( !askUserForMatch ) {
      return // do not continue onto asking user for help
    }

    this.actionNoSubFolder = {
      action, deviceView
    }
  }

  async moveOtherViewsByProfile(
    profile: ProfileManifestRead,
    deviceView: DeviceView
  ) {
    const otherViews = this.deviceViews.filter(x => x != deviceView)

    otherViews.forEach(view => {
      view.allProfiles.forEach(async otherProfile => {
        if ( otherProfile.manifest.Name === profile.manifest.Name ) {
          const otherHome = await this.session.streamdeck.getProfileHomeByDirName(otherProfile.dir.name)

          if ( !otherHome ) {
            return
          }

          this.gotoProfile(otherHome, view, false)
        }
      })
    })
  }
  
  async moveOtherViewsByAction(
    action: ProfileAction,
    parentActions: Actions,
    deviceView: DeviceView,
    parentDir: DirectoryManager
  ) {
    // check to see if we can move other views with matching buttons
    const matchingParentAction = Object.entries(parentActions).find(([_key, parentAction]) => parentAction === action) as [ string, any ]
    if ( !matchingParentAction ) {
      console.warn('this should not happen', action, parentActions)
      return
    }

    const actionKey = matchingParentAction[0]
    const otherViews = this.deviceViews.filter(x => x != deviceView)
    otherViews.forEach(async otherView => {
      if ( !otherView.lockNav ) {
        return
      }

      const otherActions = otherView.currentProfile.manifest.Controllers[0].Actions
      const otherAction = otherActions[actionKey]
      const matched = actionsMatch(action, parentDir, otherAction, otherView.currentProfile.dir)
      if ( !matched ) {
        return
      }
      
      switch (action.Name) {
        case 'Create Folder':
          this.activateChildFolder(otherAction, otherView, {
            // viewAll: false,
            moveOtherViews: false,
            askUserForMatch: false
          })    
          break      
        case 'Switch Profile':
          this.activateSwitchProfile(otherAction, otherView, {
            moveOtherViews: false,
          })    
          break      
      }
    })
  }

  async activateSwitchProfile(
    action: ProfileAction,
    deviceView: DeviceView,
    { moveOtherViews = true } = {}
  ) {
    const settings = action.Settings
  
    if ( settings.DeviceUUID ) {
      throw new Error('Switching device profiles not possible yet in this app')
    }
    const profile = await this.session.streamdeck.getProfileHomeById(settings.ProfileUUID)
    if ( !profile ) {
      throw new Error(`Cannot find profile home by id ${settings.ProfileUUID}`)
    }
    
    this.gotoProfile(profile, deviceView, moveOtherViews)
  }

  async gotoProfile(
    profile: ProfileFolderManifestRead,
    deviceView: DeviceView,
    moveOtherViews: boolean
  ) {
    deviceView.currentProfile = profile
    const currentProfileName = deviceView.currentProfile.profile.manifest.Name
    deviceView.currentProfileName = currentProfileName
    
    if ( moveOtherViews ) {
      const parentProfile = deviceView.currentProfile.profile
      //const parentActions = parentProfile.manifest.Controllers[0].Actions
      const parentDir = parentProfile.dir
      const profile = await this.session.streamdeck.getProfileHomeByDirName(parentDir.name)
      if ( !profile ) {
        return
      }
      
      this.moveOtherViewsByProfile(deviceView.currentProfile.profile, deviceView)
    }
  }

  gotoProfileByName(name: string, deviceView: DeviceView) {
    deviceView.allProfiles.forEach(async view => {
      if ( view.manifest.Name != name ) {
        return
      }

      const profile = await this.session.streamdeck.getProfileHomeByDirName(view.dir.name)
      if ( !profile ) {
        return
      }

      this.gotoProfile(profile, deviceView, true)
    })
  }

  async deleteDeviceViewAction(
    deviceView: DeviceView,
  ) {
    if ( !deviceView.action ) {
      console.warn('a device action is not currently being edited')
      return
    }

    if ( !this.prompts.confirm('Confirm delete action') ) {
      return
    }

    const profileFolder = deviceView.currentProfile
    await deleteProfileAction(deviceView.action, profileFolder)
  }
}

export async function deleteProfileAction(
  action: ProfileAction,
  profileFolder : ProfileFolderManifestRead
) {
  const control = profileFolder.manifest.Controllers[0]
  const actions = control.Actions

  const entries = Object.entries(actions)
  const index = entries.findIndex(a => a[1] === action)

  if ( index < 0 ) {
    console.warn('cannot find to delete')
    return // cannot find to delete
  }

  const key: string = entries[index][0]
  delete actions[key]
  
  const newManifest = JSON.stringify(profileFolder.manifest, null, 2)
  await profileFolder.manifestFile.write( newManifest )
}

export interface GridLayout {
  rows: number
  columns: number
}

export function getGridLayoutByActions(actions: Actions): GridLayout {
  const buttonMap = getDeviceViewButtonsByActions(actions)
  const maxColumnCount = buttonMap.reduce((all,row) => row.length > all ? row.length : all, 0)
  return {columns: maxColumnCount, rows: buttonMap.length}
}

async function getImageByActionAndDir(
  action: ProfileAction,
  dir: DirectoryManager,
) {
  const imagePath = action.States[0].Image
  return await dir.findFileByPath(imagePath)        
}

async function actionsMatch(
  action: ProfileAction,
  parentDir: DirectoryManager,
  otherAction: ProfileAction,
  otherDir: DirectoryManager,
) {
  const imageFile = await getImageByActionAndDir(action, parentDir)
  if ( !imageFile ) {
    return false
  }
  
  const imageBase = await imageFile.readAsDataURL()
  if ( !otherAction ) {
    return false// it doesn't have a button in position we want
  }

  if ( otherAction.Name !== action.Name ) {
    return false // name does not match
  }

  if ( otherAction.UUID !== action.UUID ) {
    return false// action type UUID does not match
  }

  const otherImageFile = await getImageByActionAndDir(otherAction, otherDir)
  if ( !otherImageFile ) {
    return false
  }

  const otherImageBase = await otherImageFile.readAsDataURL()
  if ( imageBase !== otherImageBase ) {
    return false // its not the same image
  }

  return true
}

export async function getChildByAction(
  action: ProfileAction,
  profile: ProfileFolderManifestRead,
): Promise<SelectFolder | undefined> {
  const deviceRead = profile.profile
  const profileFolders = await getFoldersInProfileDir(deviceRead, profile.dir.path)
  return getChildByActionInFolders(action, profileFolders)
}

export function getChildByActionInFolders(
  action: ProfileAction,
  profileFolders: ProfileFolderManifestRead[],
): SelectFolder | undefined {
  const backButtons = getBackButtonsInFolder(profileFolders)

  const lookForId = action.Settings.ProfileUUID
  const relatedBack = backButtons.findIndex(back => back.back.Settings.ProfileUUID === lookForId)

  if ( relatedBack < 0 ) {
    return // can't find related
  }

  const related = backButtons[ relatedBack ]
  return related
}

export async function getDeviceView(
  device: Device,
  streamdeck: StreamDeck,
  { profile }: { profile?: ProfileFolderManifestRead } = {}
): Promise<DeviceView> {
  profile = profile || await streamdeck.getProfileHomeDirByDeviceId(device.UUID)

  if ( !profile ) {
    const err = new Error('Cannot find device home page')
    throw err
  }

  const actions = profile.manifest.Controllers[0].Actions
  const currentProfileName = profile.profile.manifest.Name
  const deviceView: DeviceView = {
    device, lockNav: true,
    currentProfile: profile,
    currentProfileName,
    gridLayout: getGridLayoutByActions(actions),
    allProfiles: await streamdeck.getProfileFoldersByDeviceId(device.UUID)
  }
  return deviceView
}

export async function activateChildFolderByAction(
  action: ProfileAction,
  deviceView: DeviceView,
) {
  const related = await getChildByAction(action, deviceView.currentProfile)
  if ( !related ) {
    return
  }

  // redraw buttons
  const profile = deviceView.currentProfile.profile
  deviceView.currentProfile = { ...related.folder, profile }
  return related
}

async function getActionsToKidsByProfileFolderRead(
  read: ProfileFolderManifestRead
) {
  const profile = read.profile
  const profileFolders = await getFoldersInProfileDir(profile, read.dir.path)

  const toKidButtons = profileFolders.map(folder => ({
    folder,
    toKidButtons: onlyActionsToChildren(folder.manifest.Controllers[0].Actions),
  })).filter(x => x)

  return toKidButtons
}

function findParentProfileByActionUUID(
  toKidButtons: {
    folder: ProfileFolderManifestRead;
    toKidButtons: ProfileAction[];
  }[],
  lookForId: string
): {
    folder: ProfileFolderManifestRead
    toKidButtons: ProfileAction[]
  } | undefined {
  for (let index = toKidButtons.length - 1; index >= 0; --index) {
    const toKid = toKidButtons[index]
    for (let index = toKid.toKidButtons.length - 1; index >= 0; --index) {
      const toKidButton = toKid.toKidButtons[index]
      if ( toKidButton.Settings.ProfileUUID === lookForId ) {
        return toKid
      }
    }
  }

  return
}

export async function getParentByBackAction(
  action: ProfileAction,
  profileFolder: ProfileFolderManifestRead
) {
  const toKidButtons = await getActionsToKidsByProfileFolderRead(profileFolder)

  const lookForId = action.Settings.ProfileUUID

  if ( !lookForId ) {
    throw new Error('app not yet support selecting parent...')
  }

  return findParentProfileByActionUUID(toKidButtons, lookForId)
}