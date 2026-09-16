// Crawlers and some tools request /favicon.ico blindly, without reading the
// <link rel="icon"> tag in app.html. The site icon lives in Macula, so serve
// them a permanent redirect to it instead of a noisy 404.

const ICON_URL = 'https://u.macula.link/kPT78FuvSm2Y_3BQHPApYg-7?preset=sys_md';

export const GET = () => {
  return new Response(null, {
    status: 308,
    headers: {
      Location: ICON_URL,
      'Cache-Control': 'public, max-age=86400',
    },
  });
};
