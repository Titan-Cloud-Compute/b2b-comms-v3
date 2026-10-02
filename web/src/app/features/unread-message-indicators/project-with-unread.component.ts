import { Component } from '@angular/core';
import { ProjectDetailComponent } from '../projects-and-external-organization-spaces/project-detail.component';
import { UnreadChannelListComponent } from './unread-channel-list.component';

/**
 * /projects/:id — the sibling's project detail page plus this story's channel list
 * with unread bubbles (Story: Unread Message Indicators). The sibling component is
 * reused unchanged; both children read :id from the shared ActivatedRoute.
 */
@Component({
  selector: 'app-project-with-unread',
  standalone: true,
  imports: [ProjectDetailComponent, UnreadChannelListComponent],
  template: `
    <app-project-detail />
    <section class="project-unread" data-testid="project-unread-channels" aria-label="Channels">
      <app-unread-channel-list [embedded]="true" />
    </section>
  `,
  styles: ['.project-unread { padding: 0 1.5rem 1.5rem; }'],
})
export class ProjectWithUnreadComponent {}
