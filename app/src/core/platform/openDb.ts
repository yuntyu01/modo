// 타입 검사용. 실제로는 Metro가 openDb.native.ts(Android/iOS) 또는 openDb.web.ts(데스크톱)를 고른다.
export * from './openDb.native';
