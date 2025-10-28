

export const defines = [] as string[];

export function addDefine(define: string) {
    defines.push(define);
}

export function getDefines() {
    return defines.join('\n');
}

export function resetDefines() {
    defines.length = 0;
}
