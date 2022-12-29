import { Component, Input } from "@angular/core"
import { DirectoryManager } from "ack-angular-components/directory-managers/DirectoryManagers"
import { ProfileAction } from "../elgato.types"

@Component({
  selector: 'page-button',
  templateUrl: './page-button.component.html',
}) export class PageButtonComponent {
  @Input() action!: ProfileAction
  @Input() directory!: DirectoryManager
}
