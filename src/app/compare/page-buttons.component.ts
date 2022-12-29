import { Component, EventEmitter, Input, Output, SimpleChanges } from "@angular/core";
import { DirectoryManager } from "ack-angular-components/directory-managers/DirectoryManagers";
import { Actions, ProfileAction } from "../elgato.types";
import { GridLayout } from "./navigate-devices.component";

@Component({
  selector: 'page-buttons',
  templateUrl: './page-buttons.component.html',
}) export class PageButtonsComponent {
  @Input() directory!: DirectoryManager
  @Input() actions!: Actions
  @Input() gridLayout!: GridLayout
  @Output() buttonClick = new EventEmitter<ProfileAction>()
  @Output() buttonDblClick = new EventEmitter<ProfileAction>()

  buttons: ProfileAction[][] = []

  ngOnChanges( changes: SimpleChanges ){
    if ( changes['actions'] ) {
      this.buttons = getDeviceViewButtonsByActions(this.actions, this.gridLayout)
    }
  }
}

export function getDeviceViewButtonsByActions(
  actions: Actions,
  gridLayout?: GridLayout
): ProfileAction[][] {
  const buttons: ProfileAction[][] = []

  Object.entries(actions).forEach(([key, action]) => {
    const targets = key.split(',').map((x: string) => Number(x))
    buttons[targets[1]] = buttons[targets[1]] || []
    buttons[targets[1]][targets[0]] = action
  })

  const longestRow = buttons.reduce((max,row) => {
    return row.length > max ? row.length : max
  }, 0)

  const defaultAction: ProfileAction = {
    States: [{
      Image: ''
    }]
  } as any

  const rowCount = (gridLayout?.rows || buttons.length) - 1
  for (let rowIndex = rowCount; rowIndex >= 0; --rowIndex) {
    buttons[rowIndex] = buttons[rowIndex] || []
    
    const set = buttons[rowIndex]
    const columnCount = (gridLayout?.columns || set.length) - 1
    for (let index = columnCount; index >= 0; --index) {      
      if ( !set[index] ) {
        const cloneDefault = JSON.parse(JSON.stringify(defaultAction))
        set[index] = cloneDefault
      }
    }

    while(set.length < longestRow) {
      const cloneDefault = JSON.parse(JSON.stringify(defaultAction))
      set.push(cloneDefault)
    }
  }

  return buttons
}
