import type { LayoutLoad } from './$types';

export const load: LayoutLoad = ({ url }) => {
  let queryParams = '';
  try {
    queryParams = url.searchParams.toString();
  } catch {
    // During prerendering, url.searchParams is unavailable
  }
  return { queryParams };
};
