import { Component } from '@angular/core'
import { menu } from './app.routing.module'

@Component({
  templateUrl: './menu.component.html',
})
export class MenuComponent {
  menu = menu
}