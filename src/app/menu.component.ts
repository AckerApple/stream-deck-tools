import { Component } from '@angular/core'
import { fixProfilesNav } from './app.routing.module'

@Component({
  templateUrl: './menu.component.html',
})
export class MenuComponent {
  menu = [ fixProfilesNav ]
}