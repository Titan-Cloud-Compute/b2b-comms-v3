import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../shared/auth.service';
import { InvitationResult, ProjectDetail, ProjectsApiService } from './projects-api.service';
import { projectErrorMessage } from './project-errors';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <section class="project" data-testid="project-detail-page">
      <a routerLink="/projects">Back to projects</a>
      @if (loading()) {
        <p>Loading project...</p>
      } @else if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      } @else if (project(); as p) {
        <h1 data-testid="project-heading">{{ p.organization.name || p.name }}</h1>
        @if (p.status === 'archived') {
          <p class="notice">This project is archived and read-only.</p>
        }

        <section class="files" data-testid="project-file-explorer" aria-label="File explorer">
          <h2>Files</h2>
          <a [routerLink]="['/projects', p.id, 'files']">Open file explorer</a>
        </section>

        <section class="chat" data-testid="project-chat-area" aria-label="Chat">
          <h2>Chat</h2>
          @if (p.default_channel_id) {
            <a [routerLink]="['/projects', p.id, 'channels', p.default_channel_id]">Open general channel</a>
          } @else {
            <p>No channel yet.</p>
          }
        </section>

        @if (canManage() && p.status !== 'archived') {
          <form class="invite" data-testid="invite-form" (ngSubmit)="invite()">
            <label>
              Invite external contact (email)
              <input name="inviteEmail" type="email" [(ngModel)]="inviteEmail" data-testid="invite-email" />
            </label>
            <button type="submit" [disabled]="busy()">Send invite</button>
          </form>
          @if (invitation(); as inv) {
            @if (inv.delivery === 'failed') {
              <div class="error" role="alert" data-testid="invite-delivery-failed">
                Invitation saved, but the email could not be delivered.
                <button type="button" (click)="resend()" [disabled]="busy()">Resend</button>
              </div>
            } @else {
              <p class="notice" data-testid="invite-sent">Invitation sent.</p>
            }
          }
          @if (inviteError()) {
            <p class="error" role="alert">{{ inviteError() }}</p>
          }
        }

        @if (isAdmin() && p.status !== 'archived') {
          <button type="button" data-testid="archive-project" (click)="archive()" [disabled]="busy()">Archive project</button>
        }
      }
    </section>
  `,
  styles: [
    '.project { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }',
    '.files, .chat { border: 1px solid #e5e7eb; border-radius: 0.5rem; padding: 1rem; }',
    '.invite { display: flex; gap: 0.75rem; align-items: flex-end; }',
    '.invite label { display: flex; flex-direction: column; gap: 0.25rem; }',
    '.error { color: #b91c1c; }',
    '.notice { color: #374151; }',
  ],
})
export class ProjectDetailComponent implements OnInit {
  private api = inject(ProjectsApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  readonly project = signal<ProjectDetail | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);
  readonly invitation = signal<InvitationResult | null>(null);
  readonly inviteError = signal<string | null>(null);

  inviteEmail = '';

  readonly isAdmin = computed(() => {
    const role = this.auth.user()?.role;
    return role === 'ADMIN' || role === 'SUPER_ADMIN';
  });
  readonly canManage = computed(() => this.isAdmin() || this.auth.user()?.role === 'MANAGER');

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const id = params.get('id');
      if (id) void this.load(id);
    });
  }

  async load(id: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.project.set(await this.api.get(id));
    } catch (err) {
      this.project.set(null);
      this.error.set(projectErrorMessage(err, 'Could not load project.'));
    } finally {
      this.loading.set(false);
    }
  }

  async invite(): Promise<void> {
    const p = this.project();
    const email = this.inviteEmail.trim();
    if (!p) return;
    if (!email) {
      this.inviteError.set('Email is required.');
      return;
    }
    this.busy.set(true);
    this.inviteError.set(null);
    try {
      this.invitation.set(await this.api.invite(p.id, email));
      this.inviteEmail = '';
    } catch (err) {
      this.inviteError.set(projectErrorMessage(err, 'Could not send invitation.'));
    } finally {
      this.busy.set(false);
    }
  }

  async resend(): Promise<void> {
    const inv = this.invitation();
    if (!inv) return;
    this.busy.set(true);
    this.inviteError.set(null);
    try {
      this.invitation.set(await this.api.resend(inv.id));
    } catch (err) {
      this.inviteError.set(projectErrorMessage(err, 'Could not resend invitation.'));
    } finally {
      this.busy.set(false);
    }
  }

  async archive(): Promise<void> {
    const p = this.project();
    if (!p) return;
    this.busy.set(true);
    try {
      await this.api.archive(p.id);
      await this.router.navigate(['/projects']);
    } catch (err) {
      this.error.set(projectErrorMessage(err, 'Could not archive project.'));
    } finally {
      this.busy.set(false);
    }
  }
}
