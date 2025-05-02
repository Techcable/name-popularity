function damerau_levenshtein(first: string, second: string): number {
    // TODO: Support non-BMP characters (like that's ever going to happen)
    if (first === second) return 0;
    let firstLen = first.length;
    let secondLen = second.length;
    if (firstLen === 0) return secondLen;
    if (secondLen === 0) return firstLen;


    let distances: number[][] = [];
    for (let i = 0; i < firstLen + 2; i++) {
        distances.push(Array(secondLen + 2).fill(0));
    }
    const maxDistance = firstLen + secondLen;
    distances[0][0] = maxDistance;

    for (let i = 0; i < firstLen + 1; i++) {
        distances[i + 1][0] = maxDistance;
        distances[i + 1][1] = i;
    }
    for (let j = 0; j < secondLen + 1; j++) {
        distances[0][j + 1] = maxDistance;
        distances[1][j + 1] = j;
    }

    let chars: Map<string, number> = new Map();

    for (let i = 1; i < firstLen + 1; i++) {
        let db = 0;
        for (let j = 1; j < secondLen + 1; j++) {
            let k = chars.get(second.charAt(j - 1));
            if (k === undefined) {
                k = 0;
            }
            const l = db;
            let cost = 1;
            if (first[i - 1] == second[j - 1]) {
                cost = 0;
                db = j;
            }

            const substitutionCost = distances[i][j] + cost;
            const insertionCost = distances[i][j + 1] + 1;
            const deletionCost = distances[i + 1][j] + 1;
            const transpositionCost = distances[k][l] +
                (i - k -1) + 1 + (j - l - 1);
            distances[i + 1][j + 1] = Math.min(
                substitutionCost,
                insertionCost,
                deletionCost,
                transpositionCost
            );
        }
        chars.set(first[i - 1], i);
    }
    return distances[firstLen + 1][secondLen + 1];
}
interface WorkerRequest {
    targetName: string;
    knownNames: string[];
}
const DEFAULT_SIMILAR_NAMES = 5;
onmessage = function(e: MessageEvent<WorkerRequest>) {
    const name = e.data.targetName;
    const knownNames = e.data.knownNames;
    interface NameInfo {
        name: string;
        similarity: number;
    }
    let similarNames : NameInfo[] = knownNames.map(function(targetName) {
        const similarity = damerau_levenshtein(targetName, name);
        //console.log(`Determined similarity of ${targetName} => ${similarity}`);
        return { name: targetName, similarity: similarity };
    });
    similarNames.sort((a, b) => {
        let cmp = a.similarity - b.similarity;
        if (cmp == 0) {
            if (a.name < b.name) {
                cmp = -1;
            } else if (a.name > b.name) {
                cmp = 1;
            }
        }
        return cmp;
    });
    if (similarNames[0].name == name) {
        similarNames = similarNames.slice(1, DEFAULT_SIMILAR_NAMES + 1);
    } else {
        similarNames = similarNames.slice(0, DEFAULT_SIMILAR_NAMES);
    }
    postMessage({similarNames: similarNames});
};