import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ORGANIZATION_TYPES, OrganizationType, ProjectsApi } from './projects.api';

@Component({
  selector: 'app-project-new',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
    <div class="projects-page">
      <h1 data-testid="new-project-heading">New project</h1>
      <form (ngSubmit)="submit()" data-testid="new-project-form">
        <div class="form-group">
          <label for="org-name">Organization name</label>
          <input id="org-name" name="organizationName" type="text" [(ngModel)]="organizationName" data-testid="org-name" />
        </div>
        <div class="form-group">
          <label for="org-type">Organization type</label>
          <select id="org-type" name="organizationType" [(ngModel)]="organizationType" data-testid="org-type">
            @for (t of types; track t) {
              <option [value]="t">{{ t }}</option>
            }
          </select>
        </div>
        @if (error()) {
          <p role="alert" data-testid="new-project-error">{{ error() }}</p>
        }
        <button type="submit" class="btn-primary" [disabled]="saving()" data-testid="create-project">Create project</button>
        <a routerLink="/projects">Cancel</a>
      </form>
    </div>
  `,
  styles: [`
    .projects-page { max-width: 600px; margin: 0 auto; padding: 2rem 1rem; }
    .form-group { display: flex; flex-direction: column; gap: 0.25rem; margin-bottom: 1rem; }
  `],
})
export class ProjectNewComponent {
  private api = inject(ProjectsApi);
  private router = inject(Router);

  readonly types = ORGANIZATION_TYPES;
  organizationName = '';
  organizationType: OrganizationType = 'vendor';
  saving = signal(false);
  error = signal<string | null>(null);

  async submit(): Promise<void> {
    const name = this.organizationName.trim();
    if (!name) {
      this.error.set('Organization name is required.');
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const project = await this.api.create(name, this.organizationType);
      await this.router.navigate(['/projects', project.id]);
    } catch (e) {
      this.error.set(e instanceof Error && e.message ? e.message : 'Could not create project.');
    } finally {
      this.saving.set(false);
    }
  }
}
