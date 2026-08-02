import { ILogger } from '../Utils/logger';
import { SignalKeyStore } from '../Types/Auth';
export type LIDMapping = { lid: string; pn: string };
export declare class LIDMappingStore {
    constructor(keys: SignalKeyStore, logger: ILogger);
    storeLIDPNMappings(pairs: LIDMapping[]): Promise<void>;
    getLIDForPN(pn: string): Promise<string | null>;
    getPNForLID(lid: string): Promise<string | null>;
    getLIDsForPNs(pns: string[]): Promise<LIDMapping[]>;
    getPNsForLIDs(lids: string[]): Promise<LIDMapping[]>;
    close(): void;
}
