import { Component, EventEmitter, Input, Output } from '@angular/core'
import { DirectoryManager } from 'ack-angular-components/directory-managers/DirectoryManagers';
import { StreamDeck } from './StreamDeck.class';

@Component({
  selector: 'select-elgato-session-directory',
  templateUrl: './select-elgato-session-directory.component.html',
})
export class SelectElgatoSessionDirectoryComponent {
  @Input() streamdeck!: StreamDeck
  @Input() label = 'StreamDeck'
  @Output() change = new EventEmitter<DirectoryManager>()
}