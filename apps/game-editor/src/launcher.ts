/**
 * Editrix Launcher — project hub entry point.
 *
 * Pure DOM, no framework dependency. All icons are inline SVG.
 */

// ─── SVG Icons ──────────────────────────────────────────

function svg(body: string, viewBox = '0 0 24 24'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const ICONS: Record<string, string> = {
  // Navigation
  folder: svg(
    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  ),
  'file-text': svg(
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  ),
  download: svg(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  ),
  grid: svg(
    '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  ),
  book: svg(
    '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  ),
  users: svg(
    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  ),
  heart: svg(
    '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  ),
  settings: svg(
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  ),

  // Actions
  search: svg('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  'folder-open': svg(
    '<path d="M5 19a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4l2 2h4a2 2 0 0 1 2 2v1"/><path d="M3.5 15h17l-2.5-7H6z"/>',
  ),
  plus: svg('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  'more-horizontal': svg(
    '<circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  ),
  'alert-triangle': svg(
    '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  ),
  'alert-circle': svg(
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  ),
  'alert-octagon': svg(
    '<polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  ),
  clock: svg('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),

  // Stars
  star: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  'star-filled': `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,

  // Window controls
  'win-minimize': svg('<line x1="5" y1="12" x2="19" y2="12"/>'),
  'win-maximize': svg('<rect x="5" y="5" width="14" height="14" rx="1"/>'),
  'win-close': svg('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),

  // Social
  globe: svg(
    '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  ),
  github: svg(
    '<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>',
  ),
  'message-circle': svg(
    '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  ),
  'share-2': svg(
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  ),
  'at-sign': svg(
    '<circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>',
  ),
  rss: svg(
    '<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>',
  ),

  // Objects
  box: svg(
    '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  ),
  layout: svg(
    '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/>',
  ),
  'arrow-left': svg('<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>'),

  // App icon
  'app-icon': svg(
    '<circle cx="12" cy="12" r="3"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.93 4.93l2.83 2.83"/><path d="M16.24 16.24l2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.93 19.07l2.83-2.83"/><path d="M16.24 7.76l2.83-2.83"/>',
  ),
};

function iconEl(name: string, size = 16): HTMLElement {
  const span = document.createElement('span');
  span.className = 'el-icon';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  span.style.justifyContent = 'center';
  span.style.flexShrink = '0';
  const svgStr = ICONS[name] ?? '';
  if (svgStr) {
    span.innerHTML = svgStr;
    const svgEl = span.querySelector('svg');
    if (svgEl) {
      svgEl.setAttribute('width', String(size));
      svgEl.setAttribute('height', String(size));
    }
  }
  return span;
}

// ─── Types ──────────────────────────────────────────────

type VersionStatus = 'ok' | 'project-older' | 'project-newer' | 'unknown' | 'folder-missing';

interface ProjectEntry {
  name: string;
  path: string;
  version: string | null;
  versionStatus: VersionStatus;
  lastOpened: string;
  starred: boolean;
  /** Folder still exists on disk. Set by main process via fs.existsSync. */
  exists: boolean;
  _isoDate?: string;
}

type NavId =
  | 'projects'
  | 'templates'
  | 'installs'
  | 'assets'
  | 'learn'
  | 'community'
  | 'donate'
  | 'new-project';

interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
}

const TEMPLATES: TemplateEntry[] = [
  {
    id: 'empty',
    name: 'Empty Project',
    description: 'A blank project with no pre-configured scenes or assets',
    icon: 'file-text',
  },
  {
    id: '2d-game',
    name: '2D Game',
    description: 'Basic 2D setup with sprite rendering and camera',
    icon: 'grid',
  },
  {
    id: '3d-game',
    name: '3D Game',
    description: '3D scene with PBR lighting, camera controls, and sample model',
    icon: 'box',
  },
  {
    id: 'ui-app',
    name: 'UI Application',
    description: 'App template with panels, forms, and navigation',
    icon: 'layout',
  },
  {
    id: 'node-editor',
    name: 'Node Editor',
    description: 'Visual scripting / node graph editor template',
    icon: 'share-2',
  },
];

// ─── Demo Data ──────────────────────────────────────────

/** Format an ISO date string as a relative time (e.g. "2 days ago"). */
function timeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
}

const NAV_ITEMS: { id: NavId; label: string; icon: string }[] = [
  { id: 'projects', label: 'Projects', icon: 'folder' },
  { id: 'templates', label: 'Templates', icon: 'file-text' },
  { id: 'installs', label: 'Installs', icon: 'download' },
  { id: 'assets', label: 'Assets', icon: 'grid' },
  { id: 'learn', label: 'Learn', icon: 'book' },
  { id: 'community', label: 'Community', icon: 'users' },
  { id: 'donate', label: 'Donate', icon: 'heart' },
];

const SOCIAL_ITEMS = ['globe', 'github', 'message-circle', 'share-2', 'at-sign', 'rss'];

// ─── Electron API ───────────────────────────────────────

const api = (
  window as unknown as {
    electronAPI?: {
      minimize(): void;
      maximize(): void;
      close(): void;
      openProject(path: string): void;
      getHomePath(): string;
      selectFolder(): Promise<string | null>;
      listProjects(): Promise<ProjectEntry[]>;
      createProject(
        projectPath: string,
        projectConfig: unknown,
      ): Promise<{ success: boolean; error?: string }>;
      toggleStar(projectPath: string): Promise<boolean>;
      removeProject(projectPath: string): Promise<{ success: boolean }>;
      revealInFinder(projectPath: string): Promise<{ success: boolean; error?: string }>;
    };
  }
).electronAPI;

// ─── State ──────────────────────────────────────────────

let activeNav: NavId = 'projects';
let filterText = '';
let projects: ProjectEntry[] = [];
let selectedTemplate = 'empty';
let newProjectName = 'My Game';
let newProjectLocation = '';

// ─── Render ─────────────────────────────────────────────

function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = '';
  app.className = 'el-root';

  // Title bar
  const titlebar = el('div', 'el-titlebar');
  titlebar.style.cssText = '-webkit-app-region: drag';

  const titleLeft = el('div', 'el-titlebar-left');
  titleLeft.appendChild(iconEl('app-icon', 14));
  const titleText = el('span');
  titleText.textContent = 'Editrix Launcher';
  titleText.style.fontSize = '12px';
  titleLeft.appendChild(titleText);
  titlebar.appendChild(titleLeft);

  const titleRight = el('div', 'el-titlebar-right');
  titleRight.style.cssText = '-webkit-app-region: no-drag';
  for (const { icon, action, cls } of [
    { icon: 'win-minimize', action: () => api?.minimize(), cls: '' },
    { icon: 'win-maximize', action: () => api?.maximize(), cls: '' },
    { icon: 'win-close', action: () => api?.close(), cls: 'el-win-close' },
  ]) {
    const btn = el('button', `el-win-btn ${cls}`);
    btn.appendChild(iconEl(icon, 14));
    btn.addEventListener('click', action);
    titleRight.appendChild(btn);
  }
  titlebar.appendChild(titleRight);
  app.appendChild(titlebar);

  // Banner
  const banner = el('div', 'el-banner');
  const logoText = el('div', 'el-banner-logo');
  logoText.textContent = 'EDITRIX';
  banner.appendChild(logoText);
  app.appendChild(banner);

  // Body (sidebar + main)
  const body = el('div', 'el-body');

  // Sidebar
  const sidebar = el('div', 'el-sidebar');
  const navList = el('div', 'el-nav');
  for (const item of NAV_ITEMS) {
    const navItem = el('div', `el-nav-item${item.id === activeNav ? ' el-nav-item--active' : ''}`);
    navItem.appendChild(iconEl(item.icon, 16));
    const label = el('span');
    label.textContent = item.label;
    navItem.appendChild(label);
    navItem.addEventListener('click', () => {
      activeNav = item.id;
      render();
    });
    navList.appendChild(navItem);
  }
  sidebar.appendChild(navList);

  const spacer = el('div');
  spacer.style.flex = '1';
  sidebar.appendChild(spacer);

  // Settings — placeholder; nav state isn't wired to a panel yet so we mark
  // the item visually inert rather than giving it a false hover affordance.
  const settingsItem = el('div', 'el-nav-item el-nav-item--disabled');
  settingsItem.title = 'Settings — coming soon';
  settingsItem.appendChild(iconEl('settings', 16));
  const settingsLabel = el('span');
  settingsLabel.textContent = 'Settings';
  settingsItem.appendChild(settingsLabel);
  sidebar.appendChild(settingsItem);

  // Social icons — decorative until URLs are wired. Hidden from focus order
  // and styled so users don't expect them to be clickable.
  const social = el('div', 'el-social el-social--disabled');
  for (const name of SOCIAL_ITEMS) {
    const btn = el('span', 'el-social-btn');
    btn.title = 'Coming soon';
    btn.appendChild(iconEl(name, 14));
    social.appendChild(btn);
  }
  sidebar.appendChild(social);

  body.appendChild(sidebar);

  // Main content
  const main = el('div', 'el-main');

  if (activeNav === 'projects') {
    renderProjects(main);
  } else if (activeNav === 'new-project') {
    renderNewProject(main);
  } else {
    const placeholder = el('div', 'el-placeholder');
    placeholder.textContent = `${NAV_ITEMS.find((n) => n.id === activeNav)?.label ?? ''} — Coming soon`;
    main.appendChild(placeholder);
  }

  body.appendChild(main);
  app.appendChild(body);
}

function renderProjects(main: HTMLElement): void {
  // Toolbar
  const toolbar = el('div', 'el-toolbar');

  const searchWrap = el('div', 'el-search-wrap');
  const searchInput = el('input', 'el-search-input') as HTMLInputElement;
  searchInput.type = 'text';
  searchInput.placeholder = 'Search';
  searchInput.value = filterText;
  searchInput.addEventListener('input', () => {
    filterText = searchInput.value.toLowerCase();
    renderProjectList(listContainer);
  });
  searchWrap.appendChild(searchInput);
  const searchIconEl = el('span', 'el-search-icon');
  searchIconEl.appendChild(iconEl('search', 14));
  searchWrap.appendChild(searchIconEl);
  toolbar.appendChild(searchWrap);

  const openBtn = el('button', 'el-btn el-btn--secondary');
  openBtn.textContent = 'Open Project  ';
  openBtn.appendChild(iconEl('folder-open', 14));
  openBtn.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const folder = await api?.selectFolder();
      if (folder) api?.openProject(folder);
    })();
  });
  toolbar.appendChild(openBtn);

  const newBtn = el('button', 'el-btn el-btn--primary');
  newBtn.textContent = 'New Project  ';
  newBtn.appendChild(iconEl('plus', 14));
  newBtn.addEventListener('click', () => {
    activeNav = 'new-project';
    render();
  });
  toolbar.appendChild(newBtn);

  main.appendChild(toolbar);

  // Table header
  const header = el('div', 'el-table-header');
  const starCol = el('span', 'el-col-star');
  starCol.appendChild(iconEl('star', 12));
  header.appendChild(starCol);
  const nameCol = el('span', 'el-col-name');
  nameCol.textContent = 'PROJECT';
  header.appendChild(nameCol);
  const versionCol = el('span', 'el-col-version');
  versionCol.textContent = 'EDITRIX VERSION';
  header.appendChild(versionCol);
  const openedCol = el('span', 'el-col-opened');
  openedCol.textContent = 'LAST OPENED';
  header.appendChild(openedCol);
  const moreCol = el('span', 'el-col-more');
  header.appendChild(moreCol);
  main.appendChild(header);

  // Project list
  const listContainer = el('div', 'el-project-list');
  renderProjectList(listContainer);
  main.appendChild(listContainer);
}

function versionBadge(status: VersionStatus, projectVersion: string | null): HTMLElement | null {
  if (status === 'ok' || status === 'folder-missing') return null;

  const badge = el('span', 'el-version-badge');
  let icon: string;
  let tooltip: string;
  let tone: string;
  switch (status) {
    case 'project-older':
      icon = 'alert-triangle';
      tone = 'el-version-badge--warn';
      tooltip = `Project created with v${projectVersion ?? '?'}. Will be upgraded on save.`;
      break;
    case 'project-newer':
      icon = 'alert-octagon';
      tone = 'el-version-badge--error';
      tooltip = `Project requires v${projectVersion ?? '?'}. Upgrade Editrix to open.`;
      break;
    case 'unknown':
    default:
      icon = 'alert-circle';
      tone = 'el-version-badge--muted';
      tooltip = 'editrix.json is missing or unreadable.';
      break;
  }
  badge.classList.add(tone);
  badge.title = tooltip;
  badge.appendChild(iconEl(icon, 14));
  return badge;
}

function renderProjectList(container: HTMLElement): void {
  container.innerHTML = '';
  const filtered = projects.filter(
    (p) =>
      !filterText ||
      p.name.toLowerCase().includes(filterText) ||
      p.path.toLowerCase().includes(filterText),
  );

  for (const project of filtered) {
    const row = el('div', 'el-project-row');
    if (!project.exists) row.classList.add('el-project-row--missing');

    // Star
    const star = el('span', 'el-col-star el-star');
    star.appendChild(iconEl(project.starred ? 'star-filled' : 'star', 16));
    if (project.starred) star.classList.add('el-star--active');
    star.addEventListener('click', (e) => {
      e.stopPropagation();
      project.starred = !project.starred;
      void api?.toggleStar(project.path);
      renderProjectList(container);
    });
    row.appendChild(star);

    // Name + path
    const nameCell = el('div', 'el-col-name');
    const nameText = el('div', 'el-project-name');
    nameText.textContent = project.name;
    if (!project.exists) {
      const missingTag = el('span', 'el-project-missing-tag');
      missingTag.textContent = 'Missing';
      nameText.appendChild(missingTag);
    }
    nameCell.appendChild(nameText);
    const pathText = el('div', 'el-project-path');
    pathText.textContent = project.path;
    pathText.title = project.exists ? project.path : `Folder no longer exists: ${project.path}`;
    nameCell.appendChild(pathText);
    row.appendChild(nameCell);

    const versionCell = el('span', 'el-col-version');
    const versionText = el('span', 'el-version-text');
    versionText.textContent = project.exists ? (project.version ?? '—') : '—';
    versionCell.appendChild(versionText);
    if (project.exists) {
      const badge = versionBadge(project.versionStatus, project.version);
      if (badge) versionCell.appendChild(badge);
    }
    row.appendChild(versionCell);

    // Last opened
    const openedCell = el('span', 'el-col-opened');
    openedCell.appendChild(iconEl('clock', 12));
    const openedText = el('span');
    openedText.textContent = ` ${project.lastOpened}`;
    openedCell.appendChild(openedText);
    row.appendChild(openedCell);

    // More menu — opens row context menu (Open / Reveal / Remove).
    const more = el('span', 'el-col-more el-more-btn');
    more.title = 'More options';
    more.appendChild(iconEl('more-horizontal', 16));
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      showRowMenu(project, rect.right, rect.bottom);
    });
    row.appendChild(more);

    // Right-click anywhere on the row: same menu.
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showRowMenu(project, e.clientX, e.clientY);
    });

    // Double-click opens project — but if the folder is missing, prompt
    // to remove from list instead of failing silently in the editor.
    row.addEventListener('dblclick', () => {
      if (project.exists) {
        api?.openProject(project.path);
      } else {
        void confirmAndRemoveMissing(project);
      }
    });

    container.appendChild(row);
  }
}

/** Tiny in-DOM context menu — same idea as showContextMenu in view-dom but
 *  the launcher is a separate window with no framework deps. */
function showRowMenu(project: ProjectEntry, x: number, y: number): void {
  // Close any prior menu.
  document.querySelectorAll('.el-row-menu').forEach((n) => {
    n.remove();
  });

  const menu = el('div', 'el-row-menu');
  menu.style.left = `${String(x)}px`;
  menu.style.top = `${String(y)}px`;

  const addItem = (
    label: string,
    icon: string,
    onClick: () => void,
    opts?: { destructive?: boolean; disabled?: boolean },
  ): void => {
    const item = el('div', 'el-row-menu-item');
    if (opts?.destructive) item.classList.add('el-row-menu-item--destructive');
    if (opts?.disabled) item.classList.add('el-row-menu-item--disabled');
    item.appendChild(iconEl(icon, 14));
    const text = el('span');
    text.textContent = label;
    item.appendChild(text);
    if (!opts?.disabled) {
      item.addEventListener('click', () => {
        menu.remove();
        onClick();
      });
    }
    menu.appendChild(item);
  };

  addItem(
    'Open',
    'folder-open',
    () => {
      api?.openProject(project.path);
    },
    { disabled: !project.exists },
  );
  addItem(
    'Reveal in Finder',
    'folder',
    () => {
      void api?.revealInFinder(project.path);
    },
    { disabled: !project.exists },
  );
  const sep = el('div', 'el-row-menu-sep');
  menu.appendChild(sep);
  addItem(
    'Remove from list',
    'x',
    () => {
      void removeProjectFromList(project.path);
    },
    { destructive: true },
  );

  document.body.appendChild(menu);

  // Position so it stays inside the viewport.
  const menuRect = menu.getBoundingClientRect();
  if (x + menuRect.width > window.innerWidth)
    menu.style.left = `${String(window.innerWidth - menuRect.width - 4)}px`;
  if (y + menuRect.height > window.innerHeight)
    menu.style.top = `${String(window.innerHeight - menuRect.height - 4)}px`;

  // Click-outside dismisses.
  setTimeout(() => {
    const close = (ev: MouseEvent): void => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', close);
      }
    };
    document.addEventListener('mousedown', close);
  }, 0);
}

async function removeProjectFromList(projectPath: string): Promise<void> {
  if (!api) return;
  await api.removeProject(projectPath);
  projects = await loadProjects();
  render();
}

async function confirmAndRemoveMissing(project: ProjectEntry): Promise<void> {
  // Tiny confirm dialog — launcher is framework-free so we roll our own.
  const ok = window.confirm(
    `"${project.name}" no longer exists at:\n${project.path}\n\nRemove it from the list?`,
  );
  if (ok) await removeProjectFromList(project.path);
}

function renderNewProject(main: HTMLElement): void {
  // Back button
  const topBar = el('div', 'el-np-topbar');
  const backBtn = el('div', 'el-np-back');
  backBtn.appendChild(iconEl('arrow-left', 16));
  const backLabel = el('span');
  backLabel.textContent = 'Back';
  backBtn.appendChild(backLabel);
  backBtn.addEventListener('click', () => {
    activeNav = 'projects';
    render();
  });
  topBar.appendChild(backBtn);

  const topTitle = el('div', 'el-np-title');
  topTitle.textContent = 'New Project';
  topBar.appendChild(topTitle);

  main.appendChild(topBar);

  // Scrollable content
  const content = el('div', 'el-np-content');

  // Template section
  const tplSection = el('div', 'el-np-section');
  const tplLabel = el('div', 'el-np-section-label');
  tplLabel.textContent = 'Choose a template';
  tplSection.appendChild(tplLabel);

  const tplGrid = el('div', 'el-np-tpl-grid');
  for (const tpl of TEMPLATES) {
    const card = el(
      'div',
      `el-np-tpl-card${tpl.id === selectedTemplate ? ' el-np-tpl-card--selected' : ''}`,
    );
    card.addEventListener('click', () => {
      selectedTemplate = tpl.id;
      render();
    });

    const cardIcon = el('div', 'el-np-tpl-icon');
    cardIcon.appendChild(iconEl(tpl.icon, 32));
    card.appendChild(cardIcon);

    const cardName = el('div', 'el-np-tpl-name');
    cardName.textContent = tpl.name;
    card.appendChild(cardName);

    const cardDesc = el('div', 'el-np-tpl-desc');
    cardDesc.textContent = tpl.description;
    card.appendChild(cardDesc);

    tplGrid.appendChild(card);
  }
  tplSection.appendChild(tplGrid);
  content.appendChild(tplSection);

  // Project settings section
  const settSection = el('div', 'el-np-section');
  const settLabel = el('div', 'el-np-section-label');
  settLabel.textContent = 'Project Settings';
  settSection.appendChild(settLabel);

  const form = el('div', 'el-np-form');

  // Project Name
  const nameRow = el('div', 'el-np-field');
  const nameLbl = el('label', 'el-np-field-label');
  nameLbl.textContent = 'Project Name';
  nameRow.appendChild(nameLbl);
  const nameInput = el('input', 'el-np-input') as HTMLInputElement;
  nameInput.type = 'text';
  nameInput.value = newProjectName;
  nameInput.addEventListener('input', () => {
    newProjectName = nameInput.value;
    pathPreview.textContent = pathJoin(newProjectLocation, toSlug(newProjectName));
  });
  nameRow.appendChild(nameInput);
  form.appendChild(nameRow);

  // Location
  const locRow = el('div', 'el-np-field');
  const locLbl = el('label', 'el-np-field-label');
  locLbl.textContent = 'Location';
  locRow.appendChild(locLbl);
  const locWrap = el('div', 'el-np-loc-wrap');
  const locInput = el('input', 'el-np-input') as HTMLInputElement;
  locInput.type = 'text';
  locInput.value = newProjectLocation;
  locInput.addEventListener('input', () => {
    newProjectLocation = locInput.value;
    pathPreview.textContent = pathJoin(newProjectLocation, toSlug(newProjectName));
  });
  locWrap.appendChild(locInput);
  const browseBtn = el('button', 'el-np-browse-btn');
  browseBtn.appendChild(iconEl('folder-open', 14));
  browseBtn.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const selected = await api?.selectFolder();
      if (selected) {
        newProjectLocation = selected;
        locInput.value = selected;
        pathPreview.textContent = pathJoin(newProjectLocation, toSlug(newProjectName));
      }
    })();
  });
  locWrap.appendChild(browseBtn);
  locRow.appendChild(locWrap);
  form.appendChild(locRow);

  // Editrix Version
  const verRow = el('div', 'el-np-field');
  const verLbl = el('label', 'el-np-field-label');
  verLbl.textContent = 'Editrix Version';
  verRow.appendChild(verLbl);
  const verSelect = el('select', 'el-np-input') as HTMLSelectElement;
  for (const v of ['0.1.0']) {
    const opt = el('option') as HTMLOptionElement;
    opt.value = v;
    opt.textContent = v;
    verSelect.appendChild(opt);
  }
  verRow.appendChild(verSelect);
  form.appendChild(verRow);

  // Path preview
  const pathPreview = el('div', 'el-np-path-preview');
  pathPreview.textContent = pathJoin(newProjectLocation, toSlug(newProjectName));
  form.appendChild(pathPreview);

  settSection.appendChild(form);
  content.appendChild(settSection);

  main.appendChild(content);

  // Bottom actions
  const actions = el('div', 'el-np-actions');
  const cancelBtn = el('button', 'el-btn el-btn--secondary');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    activeNav = 'projects';
    render();
  });
  actions.appendChild(cancelBtn);

  const createBtn = el('button', 'el-btn el-btn--primary');
  createBtn.textContent = 'Create Project  ';
  createBtn.appendChild(iconEl('plus', 14));
  createBtn.addEventListener('click', () => {
    void (async (): Promise<void> => {
      const projectPath = pathJoin(newProjectLocation, toSlug(newProjectName));
      const projectConfig = {
        name: newProjectName,
        version: '0.1.0',
        editrix: '0.1.0',
        template: selectedTemplate,
        plugins: {
          builtin: true,
          // Scene/ECS support is built into the editor itself; templates only add
          // optional ecosystem plugins on top.
          packages: [],
        },
        settings: {},
        assets: { roots: ['assets'], ignore: ['*.tmp', '.DS_Store', 'Thumbs.db'] },
      };

      const result = await api?.createProject(projectPath, projectConfig);
      if (result?.success) {
        api?.openProject(projectPath);
      }
    })();
  });
  actions.appendChild(createBtn);
  main.appendChild(actions);
}

function toSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

function pathJoin(base: string, name: string): string {
  // Remove trailing slashes from base
  const cleaned = base.replace(/[/\\]+$/, '');
  const sep = cleaned.includes('\\') ? '\\' : '/';
  return `${cleaned}${sep}${name}`;
}

// ─── Helpers ────────────────────────────────────────────

function el(tag: string, className?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

// ─── Styles ─────────────────────────────────────────────

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
/* ── Scrollbar ── */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.12);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.2); }
::-webkit-scrollbar-corner { background: transparent; }

.el-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #1b1b1f;
  color: #ccc;
  font-size: 13px;
  user-select: none;
}

/* ── Title bar ── */
.el-titlebar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 8px;
  background: #1b1b1f;
  flex-shrink: 0;
}
.el-titlebar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #7e7e86;
}
.el-titlebar-right {
  display: flex;
  gap: 2px;
}
.el-win-btn {
  background: none;
  border: none;
  color: #7e7e86;
  width: 32px;
  height: 28px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.el-win-btn:hover { background: rgba(255,255,255,0.08); color: #ccc; }
.el-win-close:hover { background: #e55561; color: #fff; }

/* ── Banner ── */
.el-banner {
  height: 120px;
  flex-shrink: 0;
  background: linear-gradient(135deg, #2a1a0e 0%, #1a2a1e 30%, #1a1e2a 60%, #2a1a2e 100%);
  display: flex;
  align-items: center;
  padding: 0 32px;
  position: relative;
  overflow: hidden;
}
.el-banner::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, transparent 60%, #1b1b1f 100%);
}
.el-banner-logo {
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 6px;
  color: #fff;
  position: relative;
  z-index: 1;
  text-shadow: 0 2px 20px rgba(0,0,0,0.5);
}

/* ── Body ── */
.el-body {
  display: flex;
  flex: 1;
  min-height: 0;
}

/* ── Sidebar ── */
.el-sidebar {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 0;
  background: #1b1b1f;
  border-right: 1px solid #2e2e34;
}
.el-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 8px;
}
.el-nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  color: #999;
  font-size: 13px;
}
.el-nav-item:hover {
  background: rgba(255,255,255,0.04);
  color: #ccc;
}
.el-nav-item--active {
  background: rgba(255,255,255,0.06);
  color: #fff;
}
.el-nav-item--disabled {
  cursor: default;
  opacity: 0.4;
}
.el-nav-item--disabled:hover {
  background: transparent;
  color: #999;
}

/* ── Social ── */
.el-social {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  justify-content: center;
}
.el-social-btn {
  cursor: pointer;
  color: #555;
}
.el-social-btn:hover { color: #aaa; }
.el-social--disabled .el-social-btn {
  cursor: default;
  opacity: 0.5;
}
.el-social--disabled .el-social-btn:hover { color: #555; }

/* ── Main ── */
.el-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #252529;
  min-width: 0;
}

/* ── Toolbar ── */
.el-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  flex-shrink: 0;
}
.el-search-wrap {
  flex: 1;
  position: relative;
}
.el-search-input {
  width: 100%;
  background: #414141;
  border: none;
  color: #ccc;
  padding: 8px 36px 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  box-sizing: border-box;
}
.el-search-input::placeholder { color: #7e7e86; }
.el-search-input:focus { box-shadow: 0 0 0 1px #4a8fff; }
.el-search-icon {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #7e7e86;
  pointer-events: none;
  display: flex;
}

/* ── Buttons ── */
.el-btn {
  border: none;
  padding: 8px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.el-btn--primary {
  background: #4a8fff;
  color: #fff;
}
.el-btn--primary:hover { background: #5a9aff; }
.el-btn--secondary {
  background: #333338;
  color: #ccc;
  border: 1px solid #444;
}
.el-btn--secondary:hover { background: #3a3a40; }

/* ── Table ── */
.el-table-header {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid #2e2e34;
  font-size: 11px;
  color: #7e7e86;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;
}
.el-project-list {
  flex: 1;
  overflow-y: auto;
}
.el-project-row {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  cursor: pointer;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.el-project-row:hover {
  background: rgba(255,255,255,0.03);
}
.el-project-row--missing {
  opacity: 0.5;
}
.el-project-row--missing:hover {
  opacity: 0.65;
}
.el-project-missing-tag {
  display: inline-block;
  margin-left: 8px;
  padding: 1px 6px;
  background: rgba(229, 85, 97, 0.15);
  color: #e55561;
  border: 1px solid rgba(229, 85, 97, 0.3);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  vertical-align: middle;
  letter-spacing: 0.03em;
}

/* Row context menu */
.el-row-menu {
  position: fixed;
  background: #2c2c32;
  border: 1px solid #444;
  border-radius: 6px;
  padding: 4px;
  min-width: 180px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  z-index: 99999;
  font-size: 13px;
}
.el-row-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  color: #ccc;
  cursor: pointer;
  border-radius: 4px;
}
.el-row-menu-item:hover {
  background: rgba(255,255,255,0.06);
}
.el-row-menu-item--destructive { color: #e55561; }
.el-row-menu-item--destructive:hover { background: rgba(229, 85, 97, 0.12); }
.el-row-menu-item--disabled {
  opacity: 0.4;
  cursor: default;
}
.el-row-menu-item--disabled:hover { background: transparent; }
.el-row-menu-sep {
  height: 1px;
  margin: 4px 0;
  background: #3a3a40;
}

/* Columns */
.el-col-star { width: 36px; text-align: center; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.el-col-name { flex: 1; min-width: 0; padding-right: 16px; }
.el-col-version { width: 140px; flex-shrink: 0; text-align: center; display: flex; align-items: center; justify-content: center; gap: 4px; }
.el-col-opened { width: 140px; flex-shrink: 0; color: #7e7e86; display: flex; align-items: center; gap: 4px; }
.el-col-more { width: 36px; flex-shrink: 0; text-align: center; display: flex; align-items: center; justify-content: center; }

/* Star */
.el-star { cursor: pointer; color: #555; }
.el-star:hover { color: #dba843; }
.el-star--active { color: #dba843; }

/* Project name/path */
.el-project-name {
  font-size: 13px;
  font-weight: 500;
  color: #ddd;
  margin-bottom: 2px;
}
.el-project-path {
  font-size: 11px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Version compat badge — reports editrix.json vs. app version mismatch.
   Purposefully distinct from row-level "Missing" state (row dim + badge on
   name), so one icon never means two things. */
.el-version-text { font-variant-numeric: tabular-nums; }
.el-version-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 2px;
  cursor: help;
}
.el-version-badge--warn  { color: #e5c07b; }  /* older — will migrate */
.el-version-badge--error { color: #e55561; }  /* newer — blocked */
.el-version-badge--muted { color: #7e7e86; }  /* unknown — unreadable */

/* More button */
.el-more-btn {
  cursor: pointer;
  color: #555;
  border-radius: 4px;
  padding: 2px;
}
.el-more-btn:hover { background: rgba(255,255,255,0.08); color: #ccc; }

/* ── Placeholder ── */
.el-placeholder {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #555;
  font-size: 16px;
}

/* ── New Project Page ── */
.el-np-topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  border-bottom: 1px solid #2e2e34;
  flex-shrink: 0;
}
.el-np-back {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #7e7e86;
  font-size: 13px;
  padding: 4px 8px;
  border-radius: 4px;
}
.el-np-back:hover { color: #ccc; background: rgba(255,255,255,0.06); }
.el-np-title {
  font-size: 15px;
  font-weight: 600;
  color: #ddd;
}

.el-np-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}

.el-np-section {
  margin-bottom: 28px;
}
.el-np-section-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #7e7e86;
  margin-bottom: 12px;
}

/* Template grid */
.el-np-tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.el-np-tpl-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 12px 12px;
  background: #1b1b1f;
  border: 1px solid #2e2e34;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.1s, background 0.1s;
}
.el-np-tpl-card:hover {
  border-color: #444;
  background: #222226;
}
.el-np-tpl-card--selected {
  border-color: #4a8fff;
  background: rgba(74, 143, 255, 0.06);
}
.el-np-tpl-icon {
  color: #7e7e86;
  margin-bottom: 10px;
}
.el-np-tpl-card--selected .el-np-tpl-icon { color: #4a8fff; }
.el-np-tpl-name {
  font-size: 13px;
  font-weight: 500;
  color: #ddd;
  margin-bottom: 4px;
  text-align: center;
}
.el-np-tpl-desc {
  font-size: 11px;
  color: #666;
  text-align: center;
  line-height: 1.4;
}

/* Form */
.el-np-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 500px;
}
.el-np-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.el-np-field-label {
  font-size: 12px;
  color: #999;
}
.el-np-input {
  background: #414141;
  border: none;
  color: #ccc;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.el-np-input:focus { box-shadow: 0 0 0 1px #4a8fff; }
select.el-np-input {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237e7e86' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  cursor: pointer;
}

.el-np-loc-wrap {
  display: flex;
  gap: 6px;
}
.el-np-loc-wrap .el-np-input { flex: 1; }
.el-np-browse-btn {
  background: #333338;
  border: 1px solid #444;
  color: #ccc;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.el-np-browse-btn:hover { background: #3a3a40; }

.el-np-path-preview {
  font-size: 11px;
  color: #555;
  font-family: Consolas, 'Cascadia Code', monospace;
  padding: 6px 0;
}

/* Actions bar */
.el-np-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid #2e2e34;
  flex-shrink: 0;
}
`;
  document.head.appendChild(style);
}

// ─── Bootstrap ──────────────────────────────────────────

injectStyles();
const homePath = api?.getHomePath() ?? '';
newProjectLocation = homePath
  ? homePath + (homePath.includes('\\') ? '\\projects' : '/projects')
  : '';

// Load real project list then render
void (async (): Promise<void> => {
  try {
    projects = await loadProjects();
  } catch {
    projects = [];
  }
  render();
})();

interface RawProject {
  path: string;
  name: string;
  editrixVersion?: string | null;
  versionStatus?: VersionStatus;
  lastOpened: string;
  starred: boolean;
  exists: boolean;
}

async function loadProjects(): Promise<ProjectEntry[]> {
  const raw = ((await api?.listProjects()) ?? []) as RawProject[];
  return raw.map((p) => ({
    name: p.name,
    path: p.path,
    version: p.editrixVersion ?? null,
    versionStatus: p.versionStatus ?? (p.exists ? 'unknown' : 'folder-missing'),
    lastOpened: timeAgo(p.lastOpened),
    starred: p.starred,
    exists: p.exists,
    _isoDate: p.lastOpened,
  }));
}
