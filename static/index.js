$(function() {
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
    class NameData {
        constructor(name, gender, rank, count) {
            this.name = name;
            this.gender = gender;
            this.rank = rank;
            this.count = count;
        }
        static parse(data) {
            if (data == null) { return null };
            return new NameData(
                data['name'],
                data['gender'],
                data['rank'],
                data['count']
            );
        }
    }
    class YearData {
        constructor(male, female) {
            this.male = male;
            this.female = female;
        }
        static parse(data) {
            return new YearData(
                NameData.parse(data['male']),
                NameData.parse(data['female'])
            );
        }
    }
    class NameResponse {
        constructor(years, knownNames) {
            this.years = years;
            this.knownNames = knownNames;
        }
        static parse(data) {
            var years = new Map()
            Object.entries(data["years"]).forEach(function(entry) {
                var year = Number.parseInt(entry[0]);
                var data = YearData.parse(entry[1]);
                years.set(year, data);
            });
            return new NameResponse(years, data["known_names"])
        }
    }
    class NameRequest {
        constructor(name, years) {
            this.name = name;
            this.years = years;
            console.log("Created request");
        }
        get json() {
            return {
                name: this.name,
                years: this.years
            }
        }
        run(callback) {
            console.log(`Running request ${JSON.stringify(this.json)}`);
            $.ajax({
                url: "api/load",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify(this.json),
                converters: {
                    "text json": function(result) {
                        var parsed = NameResponse.parse(JSON.parse(result));
                        return parsed;
                    }
                }
            }).done(callback)
            .fail(function (jqXHR, textStatus, errorThrown) {
                console.log("Failed: " + errorThrown);
            }).always(function (a, textStatus, b) {
                console.log("Final status: " + textStatus);
            });
        }
    }
    const DEFAULT_YEARS = [...Array(18).keys()].map(i => i + 2000);
    // One of Benjamin's original obsessive names (besides the last name Shemermino)
    const DEFAULT_NAME = "Salvatore";
    const DEFAULT_SIMILAR_NAMES = 5;
    function currentName() {
        var name = $("#targetName").val();
        console.log(`Raw targetName ${name}`)
        if (name == "") {
            name = DEFAULT_NAME;
        }
        return name
    }
    function appendAverageRow(table, data_list) {
        var total_births = 0;
        var total_ranks = 0;
        var valid_entries = 0;
        for (var data of data_list) {
            if (data != null) {
                total_births += data.count;
                total_ranks += data.rank;
                valid_entries += 1;
            }
        }
        if (valid_entries > 0) {
            var average_births = Math.ceil(total_births / valid_entries);
            var average_rank = Math.round(total_ranks / valid_entries);
            table.append(`<tr class="table-primary">
                <th scope="row">Average</th>
                <td>#${average_rank}</td>
                <td>${average_births}</td>
            </tr>`)
        } else {
            table.append(`<tr class="table-primary">
                <th scope="row">Average</th>
                <td>None</td>
                <td>0</td>
            </tr>`)
        }
    }
    function appendNameRow(table, year, data) {
        if (data == null) {
            table.append(`<tr>
                <th scope="row">${year}</th>
                <td>None</th>
                <td>0</td>
            </tr>`)
        } else {
            table.append(`<tr>
                <th scope="row">${year}</th>
                <td>#${data.rank + 1}</th>
                <td>${data.count}</td>
            </tr>`)
        }
    }
    $("#loadButton").on('click', function() {
        console.log("Clicked");
        const name = currentName();
        $("#maleNameHeader").text(`Males named '${name}'`);
        $("#femaleNameHeader").text(`Females named '${name}'`);
        $("#similarNameHeader").text(`Names similar to '${name}'`);
        var similarNameList = $("#similarNames");
        var maleNameTable = $("#maleNameTableBody");
        var femaleNameTable = $("#femaleNameTableBody");
        similarNameList.empty();
        maleNameTable.empty();
        femaleNameTable.empty();
        var request = new NameRequest(currentName(), DEFAULT_YEARS);
        request.run(function(response) {
            //console.log(`Received response ${JSON.stringify(response)}`);
            var similarNames = response.knownNames.map(function(targetName) {
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
            console.assert(similarNames[0].name == name, `Expected ${name} but got ${similarNames[0].name}`);
            similarNames = similarNames.slice(1, DEFAULT_SIMILAR_NAMES + 1);
            console.log(`Determined similar names of ${similarNames.map(name => name.name)}`);
            for (let similarName of similarNames) {
                similarNameList.append(`<li>${similarName.name}</li>`);
            }
            var male_data = new Array();
            var female_data = new Array();
            for (let [year, data] of response.years) {
                male_data.push(data.male);
                female_data.push(data.female);
            }
            appendAverageRow(maleNameTable, male_data);
            appendAverageRow(femaleNameTable, female_data)
            for (let [year, data] of response.years) {
                appendNameRow(maleNameTable, year, data.male);
                appendNameRow(femaleNameTable, year, data.female);
            }

        })
    })
});
