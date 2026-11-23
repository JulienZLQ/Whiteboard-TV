import { useSyncExternalStore } from 'react';
import { joinOrigin, watchJoinOrigin } from './local-host';
export const useJoinOrigin = () => useSyncExternalStore(watchJoinOrigin, joinOrigin);
