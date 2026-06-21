function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash & 0x7fffffff;
}

const CATEGORY_HUES: Record<string, number> = {
  post: 25,
  experience: 215,
  macula: 270,
  github: 160,
};

const CATEGORY_INITIALS: Record<string, string> = {
  post: 'P',
  experience: 'E',
  macula: 'M',
  github: 'G',
};

export function nameToColor(name: string, category?: string): string {
  const hash = djb2(name);
  if (category && CATEGORY_HUES[category] !== undefined) {
    const baseHue = CATEGORY_HUES[category];
    const hueShift = (hash % 21) - 10;
    const hue = (((baseHue + hueShift) % 360) + 360) % 360;
    return `hsl(${hue}, 60%, 45%)`;
  }
  const hue = hash % 360;
  const saturation = 55 + (hash % 11);
  const lightness = 50 + (hash % 11);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

export function nameToInitial(name: string, category?: string): string {
  if (category && CATEGORY_INITIALS[category] !== undefined) {
    return CATEGORY_INITIALS[category];
  }
  if (!name) return '?';
  const match = name.match(/[a-zA-Z0-9]/);
  return match ? match[0].toUpperCase() : '?';
}
