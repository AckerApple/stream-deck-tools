import { Component, EventEmitter, Output } from '@angular/core'
import { DirectoryManager } from 'ack-angular-components/directory-managers/DirectoryManagers';
import { SessionProvider } from './session.provider';

@Component({
  selector: 'select-elgato-session-directory',
  templateUrl: './select-elgato-session-directory.component.html',
})
export class SelectElgatoSessionDirectoryComponent {
  @Output() change = new EventEmitter<DirectoryManager>()
  
  constructor(public session: SessionProvider) {}
}