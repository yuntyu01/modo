/** Public resources for the Google Play closed test. Never include account tokens in URLs. */
export const POLICY_URL = 'https://midi-broccoli-56c.notion.site/3fd5028467088169bca6fc67ea233912';
export const DELETION_URL = 'https://midi-broccoli-56c.notion.site/3fd50284670881b3bda5f7963475aa67';
/**
 * Windows용 modo(Microsoft Store). 스토어에 올라가 제품 ID가 생기면 EXPO_PUBLIC_MS_STORE_URL에
 * https://apps.microsoft.com/detail/<제품 ID> 를 넣는다. 그 전에는 스토어 검색 화면
 */
export const WINDOWS_STORE_URL = process.env.EXPO_PUBLIC_MS_STORE_URL ?? 'https://apps.microsoft.com/search?query=modo';
export const SUPPORT_URL = 'https://midi-broccoli-56c.notion.site/modo-3fd50284670881ac8891f94314cb63f1';
