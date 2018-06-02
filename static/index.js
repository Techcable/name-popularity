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
    const CURRENT_YEAR = 2018;
    const DEFAULT_START_YEAR = 1940;
    const MINIMUM_YEAR = 1880;
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
    function currentStartYear() {
        var rawYear = $("#startYear").val();
        console.log(`Raw startYear ${rawYear}`);
        if (rawYear == "") {
            rawYear = DEFAULT_START_YEAR.toString();
        }
        var year = Number.parseInt(rawYear);
        console.log(`Parsed year ${year} from ${rawYear}`)
        if (!Number.isNaN(year) && year >= MINIMUM_YEAR && year < CURRENT_YEAR) {
            return year
        }
        $("#startYear").val('');
        alert(`Invalid year '${rawYear}'`);
        return null;
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
    $("#startYear").attr("min", MINIMUM_YEAR);
    $("#startYear").attr("max", CURRENT_YEAR - 1);
    $("#startYear").attr("placeholder", DEFAULT_START_YEAR);
    $("#targetNameForm").on('submit', function(event) {
        console.log(`Submitted ${currentName()}`);
        $("#loadButton").trigger('click');
        event.preventDefault();
    })
    var nameChart = null;
    var similarityWorker = null;
    $("#loadButton").on('click', function() {
        console.log("Clicked");
        const name = currentName();
        const startYear = currentStartYear();
        if (startYear == null) return;
        const years = [...Array(CURRENT_YEAR - startYear).keys()].map(i => i + startYear);
        $("#maleNameHeader").text(`Males named '${name}'`);
        $("#femaleNameHeader").text(`Females named '${name}'`);
        $("#similarNameHeader").text(`Names similar to '${name}'`);
        $("#maleNameSpinner").addClass("fa fa-spinner fa-spin");
        $("#femaleNameSpinner").addClass("fa fa-spinner fa-spin");
        $("#similarNameSpinner").addClass("fa fa-spinner fa-spin");
        var similarNameList = $("#similarNames");
        var maleNameTable = $("#maleNameTableBody");
        var femaleNameTable = $("#femaleNameTableBody");
        similarNameList.empty();
        maleNameTable.empty();
        femaleNameTable.empty();
        if (nameChart !== null) {
            console.log(`Destroying old chart`);
            nameChart.destroy();
            nameChart = null;
            /*
             * We must completely remove the old canvas and create a new one.
             * Otherwise the two charts will both be active on the same canvas.
             * This causes the graphs to flicker back and forth whenever the user
             * hovers where the old graph used to be.
             * This is clearly a bug in ChartJS since 'destory' should be enough to eliminate the old graph
             */
            $("#nameChartDiv").empty();
            $("#nameChartDiv").append(`<canvas id="nameChart" width="100" height="100">`)
        }
        if (similarityWorker !== null) {
            similarityWorker.terminate();
            similarityWorker = null;
        }
        var request = new NameRequest(currentName(), years);
        request.run(function(response) {
            if (similarityWorker !== null) throw new Error(`Expected null but got ${similarityWorker}`);
            similarityWorker = new Worker('worker.js');
            similarityWorker.postMessage({knownNames: response.knownNames, targetName: name})
            similarityWorker.onmessage = function(e) {
                const similarNames = e.data.similarNames;
                console.log(`Determined similar names of ${similarNames.map(name => name.name)}`);
                $("#similarNameSpinner").removeClass();            
                for (let similarName of similarNames) {
                    similarNameList.append(`<li>${similarName.name}</li>`);
                }
            };
            $("#maleNameSpinner").removeClass();
            $("#femaleNameSpinner").removeClass();
            var maleBirthData = [];
            var femaleBirthData = [];
            for (let [year, data] of response.years) {
                if (data.male == null) {
                    maleBirthData.push(0);
                } else {
                    maleBirthData.push(data.male.count);
                }
                if (data.female == null) {
                    femaleBirthData.push(0);
                } else {
                    femaleBirthData.push(data.female.count);
                }
            }
            console.log(`Male births data ${JSON.stringify(maleBirthData)}`);
            if (nameChart !== null) throw new Error(`Expected null but got ${chart}`);
            nameChart = new Chart($("#nameChart"), {
                type: 'line',
                data: {
                    labels: years.slice(),                    
                    datasets: [
                        {
                            label: "Male Births",
                            data: maleBirthData,
                            fill: false,
                            borderColor: 'LightSkyBlue',
                            backgroundColor: 'SkyBlue',
                            pointBackgroundColor: 'SkyBlue',
                        },
                        {
                            label: "Female Births",
                            data: femaleBirthData,
                            fill: false,
                            borderColor: 'DeepPink',
                            backgroundColor: 'HotPink',
                            pointBackgroundColor: 'HotPink',
                        }
                    ],
                },
                options: {
                    scales: {
                        xAxes: [{
                            ticks: {
                                min: startYear,
                                max: CURRENT_YEAR - 1
                            }
                        }]
                    }
                }
            });
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
