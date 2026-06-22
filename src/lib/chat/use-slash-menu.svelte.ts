import { SLASH_COMMANDS } from './slash-commands';

export function useSlashMenu(getMessageText: () => string, onSelect: (cmd: string) => void) {
  let showSlashMenu = $state(false);
  let slashSelectedIndex = $state(0);
  let showAll = $state(false);

  const slashFiltered = $derived(
    showAll || getMessageText().startsWith('/')
      ? showAll
        ? SLASH_COMMANDS
        : SLASH_COMMANDS.filter((c) => c.triggers[0].includes(getMessageText().toLowerCase()))
      : [],
  );

  function toggle(): void {
    if (showSlashMenu) {
      showSlashMenu = false;
      showAll = false;
    } else {
      showSlashMenu = true;
      showAll = true;
      slashSelectedIndex = 0;
    }
  }

  function handleInput(): void {
    showAll = false;
    if (getMessageText().startsWith('/')) {
      showSlashMenu = true;
      slashSelectedIndex = 0;
    } else {
      showSlashMenu = false;
    }
  }

  /** Handle keyboard events for slash menu navigation. Returns true if the event was consumed. */
  function handleKeydown(e: KeyboardEvent): boolean {
    if (!showSlashMenu) return false;
    if (slashFiltered.length === 0) return false;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      slashSelectedIndex = (slashSelectedIndex + 1) % slashFiltered.length;
      return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      slashSelectedIndex = (slashSelectedIndex - 1 + slashFiltered.length) % slashFiltered.length;
      return true;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (slashFiltered.length > 0) {
        selectSlashCommand(slashFiltered[slashSelectedIndex].triggers[0]);
      }
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      showSlashMenu = false;
      showAll = false;
      return true;
    }
    return false;
  }

  function selectSlashCommand(cmd: string): void {
    showSlashMenu = false;
    showAll = false;
    onSelect(cmd);
  }

  return {
    get showSlashMenu() {
      return showSlashMenu;
    },
    get slashSelectedIndex() {
      return slashSelectedIndex;
    },
    set slashSelectedIndex(v: number) {
      slashSelectedIndex = v;
    },
    get slashFiltered() {
      return slashFiltered;
    },
    toggle,
    handleInput,
    handleKeydown,
    selectSlashCommand,
  };
}
