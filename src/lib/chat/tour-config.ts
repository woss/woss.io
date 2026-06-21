export interface TourDefinition {
  featureId: string;
  targetSelector: string;
  title: string;
  content: string;
}

export const TOUR_DEFINITIONS: TourDefinition[] = [
  {
    featureId: 'slash-commands',
    targetSelector: '#slash-commands',
    title: 'Navigation via /',
    content:
      'Press the / button to open slash commands — you can navigate to /home, /posts, /experience, and more without clicking around.',
  },
];
