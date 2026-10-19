export function uriToId(uri: string) {
  return uri
    .replace('@', '')
    .replace(':', '__')
    .replace(/\W/g, '_')
    .toLowerCase();
}
