$(function() {
    "use strict";
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
        constructor(years, similarNames) {
            this.years = years;
            this.similarNames = similarNames;
        }
        static parse(data) {
            var years = new Map()
            Object.entries(data["years"]).forEach(function(entry) {
                var year = Number.parseInt(entry[0]);
                var data = YearData.parse(entry[1]);
                years.set(year, data);
            });
            return new NameResponse(years, data["similar_names"])
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
        $("#maleNameHeader").text(`Males named '${currentName()}'`);
        $("#femaleNameHeader").text(`Females named '${currentName()}'`);
        $("#similarNameHeader").text(`Names similar to '${currentName()}'`);
        var similarNameList = $("#similarNames");
        var maleNameTable = $("#maleNameTableBody");
        var femaleNameTable = $("#femaleNameTableBody");
        similarNameList.empty();
        maleNameTable.empty();
        femaleNameTable.empty();
        var request = new NameRequest(currentName(), DEFAULT_YEARS);
        request.run(function(response) {
            console.log(`Received response ${JSON.stringify(response)}`);
            for (let similarName of response.similarNames) {
                similarNameList.append(`<li>${similarName}</li>`);
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
