"use strict";
function damerau_levenshtein(first, second) {
    "use strict";
    // TODO: Support non-BMP characters (like that's ever going to happen)
    if (first == second) return 0;
    var firstLen = first.length;
    var secondLen = second.length;
    if (firstLen == 0) return secondLen;
    if (secondLen == 0) return firstLen;


    var distances = [];
    for (var i = 0; i < firstLen + 2; i++) {
        distances.push(Array(secondLen + 2).fill(0));
    }
    const maxDistance = firstLen + secondLen;
    distances[0][0] = maxDistance;

    for (var i = 0; i < firstLen + 1; i++) {
        distances[i + 1][0] = maxDistance;
        distances[i + 1][1] = i;
    }
    for (var j = 0; j < secondLen + 1; j++) {
        distances[0][j + 1] = maxDistance;
        distances[1][j + 1] = j;
    }

    var chars = new Map();

    for (var i = 1; i < firstLen + 1; i++) {
        var db = 0;
        for (var j = 1; j < secondLen + 1; j++) {
            var k = chars.get(second.charAt(j - 1));
            if (typeof k == 'undefined') {
                k = 0;
            }
            const l = db;
            var cost = 1;
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
const DEFAULT_SIMILAR_NAMES = 5;
onmessage = function(e) {
    const name = e.data.targetName;
    const knownNames = e.data.knownNames;
    var similarNames = knownNames.map(function(targetName) {
        const similarity = damerau_levenshtein(targetName, name);
        //console.log(`Determined similarity of ${targetName} => ${similarity}`);
        return { name: targetName, similarity: similarity };
    });
    similarNames.sort(function(a, b) {
        var cmp = a.similarity - b.similarity;
        if (cmp == 0) {
            if (a.name < b.name) {
                cmp = -1;
            } else if (a.name > b.name) {
                cmp = 1;
            }
        }
        return cmp
    });
    if (similarNames[0].name == name) {
        similarNames = similarNames.slice(1, DEFAULT_SIMILAR_NAMES + 1);
    } else {
        similarNames = similarNames.slice(0, DEFAULT_SIMILAR_NAMES);
    }
    postMessage({similarNames: similarNames});
};