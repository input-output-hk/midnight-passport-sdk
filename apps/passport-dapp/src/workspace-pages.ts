/** Local page navigation only. Rendering or navigating never starts an account action. */
export function createWorkspacePages<P extends string>(
  root: HTMLElement,
  options: {
    readonly label: string;
    readonly className: string;
    readonly pages: Record<P, { label: string; controlId: string; section: HTMLElement }>;
    readonly initial: P;
    readonly onChange: (page: P) => void;
  },
) {
  const navigation = document.createElement('nav');
  navigation.className = options.className;
  navigation.setAttribute('aria-label', options.label);
  const links = new Map<P, HTMLAnchorElement>();
  const order = Object.keys(options.pages) as P[];
  for (const page of order) {
    const { label, controlId, section } = options.pages[page];
    const link = document.createElement('a');
    link.id = controlId;
    link.href = `#${root.dataset.workspace}/${page}`;
    link.textContent = label;
    section.dataset.workspacePage = page;
    section.setAttribute('aria-labelledby', controlId);
    navigation.append(link);
    links.set(page, link);
  }
  root.append(navigation);
  let selected = options.initial;
  let active = false;
  const render = () => {
    for (const page of order) {
      options.pages[page].section.hidden = page !== selected;
      if (active && page === selected) links.get(page)!.setAttribute('aria-current', 'page');
      else links.get(page)!.removeAttribute('aria-current');
    }
  };
  const select = (page: P, focus = false, notify = true) => {
    selected = page;
    render();
    if (notify) options.onChange(page);
    if (focus) links.get(page)!.focus({ preventScroll: true });
  };
  for (const [page, link] of links) {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      select(page);
    });
    link.addEventListener('keydown', (event) => {
      const index = order.indexOf(page);
      const next =
        event.key === 'ArrowDown' || event.key === 'ArrowRight'
          ? order[(index + 1) % order.length]
          : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
            ? order[(index + order.length - 1) % order.length]
            : event.key === 'Home'
              ? order[0]
              : event.key === 'End'
                ? order.at(-1)
                : undefined;
      if (!next || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      links.get(next)!.focus({ preventScroll: true });
      links.get(next)!.scrollIntoView({ block: 'nearest' });
    });
  }
  render();
  return {
    navigation,
    select,
    selected: () => selected,
    valid: (page: string): page is P => Object.hasOwn(options.pages, page),
    setActive(value: boolean) {
      active = value;
      render();
    },
  };
}
