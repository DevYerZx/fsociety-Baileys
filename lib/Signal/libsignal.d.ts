import { SignalAuthState } from '../Types';
import { SignalRepository } from '../Types/Signal';
export declare function makeLibSignalRepository(auth: SignalAuthState, logger?: import('../Utils/logger').ILogger): SignalRepository & { lidMapping: import('./lid-mapping').LIDMappingStore };
