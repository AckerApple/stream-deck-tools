import { Component } from '@angular/core'
import { Prompts } from 'ack-angular';
import { DirectoryManager } from 'ack-angular-components/directory-managers/DirectoryManagers';
import { Actions, Device, ProfileAction } from '../elgato.types';
import { SessionProvider } from '../session.provider';
import { firstBackToParentAction, getFoldersInProfileDir, onlyActionsToChildren, ProfileFolderManifestRead, ProfileManifestRead } from '../StreamDeck.class';
import { getDeviceViewButtonsByActions } from './page-buttons.component';

interface DeviceView {
  device: Device
  currentProfile: ProfileFolderManifestRead
  currentProfileName: string
  viewJson?: boolean
  action?: ProfileAction
  gridLayout: GridLayout
  allProfiles: ProfileManifestRead[]
}

@Component({
  templateUrl: './navigate-devices.component.html',
})
export class NavigateDevicesComponent {
  devices: Device[] = []
  deviceViews: DeviceView[] = []
  selectFolder?: {
    index: number
    folders: SelectFolder[]
    action: ProfileAction
    deviceView: DeviceView
    gridLayout: GridLayout
    choice?: SelectFolder
    saveIntoTitle: boolean
    saveIntoSettings: boolean
    viewAll: boolean
  }

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
    const currentProfile = await this.session.streamdeck.getProfileHomeDirByDeviceId(device.UUID)

    if ( !currentProfile ) {
      const err = new Error('Cannot find device home page')
      throw this.session.error(err.message, err)
    }
   
    const actions = currentProfile.manifest.Controllers[0].Actions
    const currentProfileName = currentProfile.deviceRead.manifest.Name
    const deviceView: DeviceView = {
      device,
      currentProfile,
      currentProfileName,
      gridLayout: getGridLayoutByActions(actions),
      allProfiles: await this.session.streamdeck.getProfileFoldersByDeviceId(device.UUID)
    }

    this.deviceViews.push(deviceView)
  }

  async activateItem(
    column: ProfileAction,
    deviceView: DeviceView
  ) {
    switch (column.UUID) {
      case 'com.elgato.streamdeck.profile.openchild': // 'Create Folder'
        this.activateChildFolder(column, deviceView)
        break
      case 'com.elgato.streamdeck.profile.backtoparent': // 'Parent Folder'
        this.activateParentFolder(column, deviceView)
        break

      case 'com.elgato.streamdeck.profile.rotate': // 'Switch Profile'
        this.activateSwitchProfile(column, deviceView)
        break
    
      default:
        console.warn(`unable to activate action of type ${column.Name}`)
    }
  }
  
  async saveChildAssociation() {
    if ( !this.selectFolder?.choice ) {
      throw new Error('this.selectFolder.choice not set')
    }

    const back = this.selectFolder.choice.back
    const states = back.States
    const state = states[0] = states[0] || {}
    const profileId = this.selectFolder.action.Settings.ProfileUUID

    if ( this.selectFolder.saveIntoSettings ) {
      back.Settings.ProfileUUID = profileId
    }

    if ( this.selectFolder.saveIntoTitle ) {
      state.ShowTitle = state.ShowTitle == undefined ? false : state.ShowTitle
      state.Title = (state.Title || '') + '\n\n\n\n\n\n' + profileId
    }
    
    const saveFolder = this.selectFolder.choice.folder
    const toSave = saveFolder.manifest
    const toSaveString = JSON.stringify(toSave, null, 2)
    ++this.session.loading
    await saveFolder.manifestFile.write(toSaveString)
    --this.session.loading
    const deviceView = this.selectFolder.deviceView
    deviceView.currentProfile = {
      ...this.selectFolder.choice.folder,
      deviceRead: deviceView.currentProfile.deviceRead
    }
    delete this.selectFolder
  }

  async activateParentFolder(
    action: ProfileAction,
    deviceView: DeviceView,
  ) {
    const deviceRead = deviceView.currentProfile.deviceRead
    const profileFolders = await getFoldersInProfileDir(deviceRead, deviceView.currentProfile.dir.path)

    const toKidButtons = profileFolders.map(folder => ({
      folder,
      toKidButtons: onlyActionsToChildren(folder.manifest.Controllers[0].Actions),
    })).filter(x => x)

    const lookForId = action.Settings.ProfileUUID

    if ( !lookForId ) {
      throw new Error('app not yet support selecting parent...')
    }

    toKidButtons.forEach(toKid => {
      toKid.toKidButtons.forEach(toKidButton => {

        if ( toKidButton.Settings.ProfileUUID === lookForId ) {
          deviceView.currentProfile = { ...toKid.folder, deviceRead }
        }
      })
    })
  }
  
  async activateChildFolder(
    action: ProfileAction,
    deviceView: DeviceView,
    { viewAll=false, moveOtherViews = true, askUserForMatch = true } = {}
  ) {
    const related = await getChildByAction(action, deviceView.currentProfile)

    if ( related ) {
      // ✅ we can navigate to the child
      // make a note of current parents before changing them
      const parentActions = deviceView.currentProfile.manifest.Controllers[0].Actions
      const parentDir = deviceView.currentProfile.dir

      // redraw buttons
      const deviceRead = deviceView.currentProfile.deviceRead
      deviceView.currentProfile = { ...related.folder, deviceRead }
      
      if ( moveOtherViews ) {
        this.moveOtherViewsByAction(action, parentActions, deviceView, parentDir)
      }

      return // no need to continue, we found where to go
    }

    if ( !askUserForMatch ) {
      return // do not continue onto asking user for help
    }

    const deviceRead = deviceView.currentProfile.deviceRead
    const profileFolders = await getFoldersInProfileDir(deviceRead, deviceView.currentProfile.dir.path)
    let backButtons = getBackButtonsInFolder(profileFolders)

    // We have to ask the user for some help
    const gridLayout: GridLayout = backButtons.reduce((all, buttons) => {
      const control = buttons.folder.manifest.Controllers[0]
      const gridLayout = getGridLayoutByActions(control.Actions)
      all.columns = all.columns > gridLayout.columns ? all.columns : gridLayout.columns
      all.rows = all.rows > gridLayout.rows ? all.rows : gridLayout.rows
      return all
    }, {rows: 0, columns: 0})

    // determine if parent or child has greater counts
    gridLayout.columns = gridLayout.columns > deviceView.gridLayout.columns ? gridLayout.columns : deviceView.gridLayout.columns
    gridLayout.rows = gridLayout.rows > deviceView.gridLayout.rows ? gridLayout.rows : deviceView.gridLayout.rows

    // reset our parent counts just incase
    deviceView.gridLayout.columns = gridLayout.columns
    deviceView.gridLayout.rows = gridLayout.rows 

    if ( !viewAll ) {
      // remove ones that already have a child assignment
      backButtons = backButtons.filter(x => !x.back?.Settings.ProfileUUID)
    }

    this.selectFolder = {
      index: 0,
      gridLayout,
      deviceView,
      viewAll,
      folders: backButtons,
      saveIntoTitle: false,
      saveIntoSettings: true,
      action
    }


    // only one options to choose from
    if ( backButtons.length === 1 ) {
      this.selectFolder.choice = backButtons[0]
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
      const otherActions = otherView.currentProfile.manifest.Controllers[0].Actions
      const otherAction = otherActions[actionKey]
      const matched = actionsMatch(action, parentDir, otherAction, otherView.currentProfile.dir)
      if ( !matched ) {
        return
      }
      
      switch (action.Name) {
        case 'Create Folder':
          this.activateChildFolder(otherAction, otherView, {
            viewAll: false,
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
    const currentProfileName = deviceView.currentProfile.deviceRead.manifest.Name
    deviceView.currentProfileName = currentProfileName
    
    if ( moveOtherViews ) {
      const parentProfile = deviceView.currentProfile.deviceRead
      //const parentActions = parentProfile.manifest.Controllers[0].Actions
      const parentDir = parentProfile.dir
      const profile = await this.session.streamdeck.getProfileHomeByDirName(parentDir.name)
      if ( !profile ) {
        return
      }
      
      this.moveOtherViewsByProfile(deviceView.currentProfile.deviceRead, deviceView)
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

    const profile = deviceView.currentProfile
    const control = profile.manifest.Controllers[0]
    const actions = control.Actions

    const entries = Object.entries(actions)
    const index = entries.findIndex(a => a[1] === deviceView.action)

    if ( index < 0 ) {
      console.warn('cannot find to delete')
      return // cannot find to delete
    }

    if ( !this.prompts.confirm('Confirm delete action') ) {
      return
    }

    const key: string = entries[index][0]
    delete actions[key]
    
    const newManifest = JSON.stringify(profile.manifest, null, 2)
    await profile.manifestFile.write( newManifest )
  }
}

interface SelectFolder {
  folder: ProfileFolderManifestRead
  back: ProfileAction
}

export interface GridLayout {
  rows: number
  columns: number
}

function getGridLayoutByActions(actions: Actions): GridLayout {
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

function getBackButtonsInFolder(
  profileFolders: ProfileFolderManifestRead[]
): SelectFolder[] {
  return profileFolders.map(folder => ({
    folder,
    back: firstBackToParentAction(folder.manifest.Controllers[0].Actions),
  })) as SelectFolder[]
}

export async function getChildByAction(
  action: ProfileAction,
  profile: ProfileFolderManifestRead,
): Promise<SelectFolder | undefined> {
  const deviceRead = profile.deviceRead
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
