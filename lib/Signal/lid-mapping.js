"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIDMappingStore = void 0;
const WABinary_1 = require("../WABinary");

class LIDMappingStore {
    constructor(keys, logger) {
        this.keys = keys;
        this.logger = logger;
        this.cache = new Map();
    }
    async storeLIDPNMappings(pairs = []) {
        const data = {};
        for (const pair of pairs) {
            let { lid, pn } = pair || {};
            if ((0, WABinary_1.isJidUser)(lid) && (0, WABinary_1.isLidUser)(pn)) {
                [lid, pn] = [pn, lid];
            }
            if (!(0, WABinary_1.isLidUser)(lid) || !(0, WABinary_1.isJidUser)(pn)) {
                this.logger?.warn({ lid, pn }, 'ignoring invalid LID-PN mapping');
                continue;
            }
            const lidUser = (0, WABinary_1.jidDecode)(lid)?.user;
            const pnUser = (0, WABinary_1.jidDecode)(pn)?.user;
            if (!lidUser || !pnUser) continue;
            data[pnUser] = lidUser;
            data[`${lidUser}_reverse`] = pnUser;
            this.cache.set(`pn:${pnUser}`, lidUser);
            this.cache.set(`lid:${lidUser}`, pnUser);
        }
        if (Object.keys(data).length) {
            await this.keys.set({ 'lid-mapping': data });
        }
    }
    async getLIDForPN(pn) {
        const decoded = (0, WABinary_1.jidDecode)(pn);
        if (!decoded || !(0, WABinary_1.isJidUser)(pn)) return null;
        let lidUser = this.cache.get(`pn:${decoded.user}`);
        if (!lidUser) {
            const stored = await this.keys.get('lid-mapping', [decoded.user]);
            lidUser = stored[decoded.user];
        }
        if (!lidUser) return null;
        this.cache.set(`pn:${decoded.user}`, lidUser);
        this.cache.set(`lid:${lidUser}`, decoded.user);
        return (0, WABinary_1.jidEncode)(lidUser, 'lid', decoded.device);
    }
    async getPNForLID(lid) {
        const decoded = (0, WABinary_1.jidDecode)(lid);
        if (!decoded || !(0, WABinary_1.isLidUser)(lid)) return null;
        let pnUser = this.cache.get(`lid:${decoded.user}`);
        if (!pnUser) {
            const key = `${decoded.user}_reverse`;
            const stored = await this.keys.get('lid-mapping', [key]);
            pnUser = stored[key];
        }
        if (!pnUser) return null;
        this.cache.set(`lid:${decoded.user}`, pnUser);
        this.cache.set(`pn:${pnUser}`, decoded.user);
        return (0, WABinary_1.jidEncode)(pnUser, 's.whatsapp.net', decoded.device);
    }
    async getLIDsForPNs(pns = []) {
        const pairs = await Promise.all(pns.map(async pn => ({ pn, lid: await this.getLIDForPN(pn) })));
        return pairs.filter(pair => pair.lid);
    }
    async getPNsForLIDs(lids = []) {
        const pairs = await Promise.all(lids.map(async lid => ({ lid, pn: await this.getPNForLID(lid) })));
        return pairs.filter(pair => pair.pn);
    }
    close() { this.cache.clear(); }
}
exports.LIDMappingStore = LIDMappingStore;
