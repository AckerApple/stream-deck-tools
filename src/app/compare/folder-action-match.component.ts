import { Component, EventEmitter, Input, Output } from "@angular/core"
import { ProfileAction } from "../elgato.types"
import { getManifestFileByProfileUuid } from "../profiles/fix-profiles-nav.component"
import { SessionProvider } from "../session.provider"
import { firstBackToParentAction, getFoldersInProfileDir, ProfileFolderManifestRead } from "../StreamDeck.class"
import { activateChildFolderByAction, DeviceView, getGridLayoutByActions, getParentByBackAction, GridLayout } from "./navigate-devices.component"

@Component({
  selector: 'folder-action-match',
  templateUrl: './folder-action-match.component.html',
  providers: [],
}) export class FolderActionMatchComponent {
  @Input() action!: ProfileAction
  @Input() deviceView!: DeviceView
  @Output() done = new EventEmitter<void>()
  @Output() success = new EventEmitter<void>()

  viewAll = false

  selectFolder!: {
    index: number
    folders: SelectFolder[]
    action: ProfileAction
    deviceView: DeviceView
    gridLayout: GridLayout
    choice?: SelectFolder // the desired matching folder
    saveIntoTitle: boolean
    saveIntoSettings: boolean
  }

  constructor(public session: SessionProvider) {
  }

  ngOnInit(){
    this.reload()
  }

  reload(){
    if ( !this.deviceView ) {
      console.error(`deviceView is undefined in ${FolderActionMatchComponent.name}`)
      return
    }

    this.showFolderMatchByDeviceView(this.action, this.deviceView)
  }

  async showFolderMatchByDeviceView(
    action: ProfileAction,
    deviceView: DeviceView
  ) {
    const dir = deviceView.currentProfile.dir
    const profile = deviceView.currentProfile.profile
    const profileFolders = await getFoldersInProfileDir(profile, dir.path)
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

    if ( !this.viewAll ) {
      // remove ones that already have a child assignment
      const checkBackButtonPromises = backButtons.map(async x => {
        const backAction = x.back
        if ( !backAction ) {
          return x // return this result as potentially a folder we might want user to select
        }

        const targetParent = await getParentByBackAction(backAction, x.folder)
        
        if ( targetParent ) {
          return // used to just check if x.back.Settings.ProfileUUID was defined but it could accidentally be defined from a copy/paste
        }

        return x
      })

      backButtons = (await Promise.all(checkBackButtonPromises)).filter(x => x) as SelectFolder[]
    }

    this.selectFolder = {
      index: 0,
      gridLayout,
      deviceView,
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
      profile: deviceView.currentProfile.profile
    }
    
    this.success.emit()
    this.done.emit()
  }

  async activateChildFolder(
    action: ProfileAction,
    deviceView: DeviceView,
  ) {
    activateChildFolderByAction(action, deviceView)
  }
}

export interface SelectFolder {
  folder: ProfileFolderManifestRead
  back: ProfileAction // the back button
}


export function getBackButtonsInFolder(
  profileFolders: ProfileFolderManifestRead[]
): SelectFolder[] {
  return profileFolders.map(folder => ({
    folder,
    back: firstBackToParentAction(folder.manifest.Controllers[0].Actions),
  })) as SelectFolder[]
}
