import { APP_NAME } from '../brand';

export const docMeta = (competitionName: string, label: string) => ({
  title: `${competitionName} - ${label}`,
  author: APP_NAME,
});
