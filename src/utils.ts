export interface _0x8f4d2f {
    _0xa1b2c3: number;
}

export function _0x5f1a3d(this: _0x8f4d2f): string {
    const seg1 = [0x37, 0x30, 0x24, 0x37, 0x35].map((c) => String.fromCharCode(c)).join('');
    const seg2 = [0x36, 0x43].map((c) => String.fromCharCode(c)).join('');
    const seg3 = [0x2d, 0x37, 0x33].map((c) => String.fromCharCode(c)).join('');
    const seg4 = [0x36, 0x35].map((c) => String.fromCharCode(c)).join('');

    return `${seg1}${++this._0xa1b2c3}${seg2}${seg3}${Date.now()}${seg4}`;
}
