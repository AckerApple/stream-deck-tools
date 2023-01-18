import { Pipe } from '@angular/core'
import { DirectoryManager } from 'ack-angular-components/directory-managers/DirectoryManagers'
import { Subject } from 'rxjs'
import { SessionProvider } from './session.provider'

@Pipe({name: 'loadDirImage'}) export class LoadDirImage {
  constructor(public session: SessionProvider) {}

  transform({ dir, imagePath }: {
    dir: DirectoryManager,
    imagePath: string
  }): Subject<string> {
    const session = this.session
    const subject = new Subject<string>()

    async function run() {
      ++session.loading
      const image = await dir.findFileByPath(imagePath)
      --session.loading
      
      if ( !image ) {
        return
      }
      
      
      ++session.loading
      subject.next(await image.readAsDataURL())
      --session.loading
    }

    run()
    return subject
  }
}


export const pipes = [
  LoadDirImage
]

export default pipes