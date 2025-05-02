$(function() {
    "use strict";
    class NameData {
        constructor(gender, rank, count) {
            this.gender = gender;
            this.rank = rank;
            this.count = count;
        }
        static parse(data) {
            if (data == null) { return null };
            return new NameData(
                data['gender'],
                data['rank'],
                data['count']
            );
        }
    }
    class YearResponse {
        constructor(totalBirths, data, ratio) {
            this.totalBirths = totalBirths;
            this.data = data;
            this.ratio = ratio;
        }
        static parse(data) {
            return new YearResponse(
                data['total_births'],
                NameData.parse(data['data']),
                data['ratio']
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
                YearResponse.parse(data['male']),
                YearResponse.parse(data['female'])
            );
        }
    }
    class NameResponse {
        constructor(years, peak, typicalGender, genderRatio) {
            this.years = years;
            this.peak = peak;
            this.typicalGender = typicalGender;
            this.genderRatio = genderRatio;
        }
        static parse(data) {
            var years = new Map()
            Object.entries(data["years"]).forEach(function(entry) {
                var year = Number.parseInt(entry[0]);
                var data = YearData.parse(entry[1]);
                years.set(year, data);
            });
            return new NameResponse(years, data["peak"], data["typical_gender"], data["gender_ratio"])
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
                        console.log(`Parsed years ${JSON.parse(result)["years"]} into ${parsed.years.size}`);
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
    class ListKnownYearsRequest {
        constructor() {}
        run(callback) {
            console.log(`Running request GET api/known_years`);
            $.ajax({
                url: "api/known_years",
                method: "GET",
                converters: {
                    "text json": function(result) {
                        return JSON.parse(result);
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
    class ListKnownNamesRequest {
        constructor() {}
        run(callback) {
            console.log(`Running request GET api/known_names`);
            $.ajax({
                url: "api/known_names",
                method: "GET",
                converters: {
                    "text json": function(result) {
                        return JSON.parse(result);
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

    class Metadata {
        constructor(yearResponse) {
            this.currentYear = yearResponse.latest_year;
            this.minimumYear = yearResponse.earliest_year;
            if (!Number.isInteger(this.currentYear)) throw new Error(`Invalid 'latest_year': ${yearResponse.latest_year}`);
            this.defaultStartYear = 1940;
            Object.freeze(this);
        }
        static INSTANCE = null;
        static requireLoaded(action) {
            if (this.INSTANCE === null) {
                alert(`Can not ${action} while initial metadata is loading`);
                return null;
            } else {
                return this.INSTANCE;
            }
        }
        static assumeLoaded() {
            if (this.INSTANCE === null) {
                throw new Error("Expected metadata to already be loaded!");
            }
            return this.INSTANCE;
        }
    }
    /*
     * TODO: This is shitty code, I need to refactor it to be more object oriented.
     * In my defense I can't think straight in this pathetic excuse for a language
     */

    new ListKnownYearsRequest().run(function (response) {
        console.assert(Metadata.INSTANCE === null, "Already initialized metadata");
        const meta = new Metadata(response);
        Metadata.INSTANCE = meta;
        console.assert(meta.minimumYear === 1880, `Unexpected minimum year ${meta.minimumYear}`);
        $("#yearRangeMessage").text(`Includes data from ${meta.minimumYear} to ${meta.currentYear}`);
        $("#startYear").attr("min", meta.minimumYear);
        $("#startYear").attr("max", meta.currentYear);
        $("#startYear").attr("placeholder", meta.defaultStartYear);
        console.log("Finished initalizing metadata");
    })
    // One of Benjamin's original obsessive names (besides the last name Shemermino)
    const DEFAULT_NAME = "Salvatore";
    function debugMap(target) {
        var result = new Object();
        for (let [key, value] of target) {
            result[key.toString()] = value;
        }
        return JSON.stringify(result);
    }
    function currentName() {
        var name = $("#targetName").val();
        console.log(`Raw targetName ${name}`)
        if (name == "") {
            name = DEFAULT_NAME;
        }
        return name
    }
    const POPULARITY_LEVEL_NAMES = [
        "Very Usual", // 1/100
        "Usual", // 1/500
        "Slightly unusual", // 1/1000
        "Unusual", // 1/3000
        "Very Unusual", // 1/10_000
        "Extremely Unusual", // 1/100_000
    ]
    const ERA_NAMES = [
        "Traditional", // before 1960
        "Modern", // between 1960-2000
        "Very Modern", // after 2000
    ];
    function averageCount(data) {
        var sum = 0;
        console.log(`Data ${data}`);
        for (let element of data) {
            if (element.data != null) {
                sum += element.data.count;
            }
        }
        return sum / data.length;
    }
    function filterYears(years, func) {
        return Array.from(years.entries())
            .filter(([year, data]) => func(year))
            .map(([year, data]) => data);
    }
    function determineEra(peak, years) {
        const SIGNIFICANCE_RATIO = .2;
        const SIGNIFICANCE_THRESHOLD = 500;
        const peakValue = years[peak];
        var era = null;
        const traditionalYears = filterYears(years, (year) => year < 1960);
        const modernYears = filterYears(years, (year) => year >= 1960 && year < 2000);
        const veryModernYears = filterYears(years, (year) => year >= 2000);
        const traditionalAverage = averageCount(traditionalYears);
        const modernAverage = averageCount(modernYears);
        const veryModernAverage = averageCount(veryModernYears);
        console.log(`Traditional average ${traditionalAverage}, modern average ${modernAverage}, very modern average ${modernAverage}`);
        if (traditionalAverage >= SIGNIFICANCE_THRESHOLD) {
            return 0
        } else if (traditionalAverage >= SIGNIFICANCE_THRESHOLD) {
            return 1;
        } else if (veryModernAverage >= SIGNIFICANCE_THRESHOLD) {
            return 2
        }
        /*
         * None of the years are 'significant' enough to meet our static threshold.
         * Instead we use a ratio as a relative percentage of the peak popularity
         */
        if ((traditionalAverage / peakValue) >= SIGNIFICANCE_RATIO) {
            return 0
        } else if ((modernAverage / peakValue) >= SIGNIFICANCE_RATIO) {
            return 1
        } else if ((veryModernAverage / peakValue) >= SIGNIFICANCE_RATIO) {
            return 2
        }
        /*
         * Um, now it appears we have a massive peak relative
         * to the average of each era.
         * Instead we return the era with the maximum
         */
        if (veryModernAverage >= modernAverage) {
            // now we know that modernAverage <= veryModernAverage
            if (traditionalAverage >= veryModernAverage) {
                // modernAverage <= veryModernAverage <= traditionalAverage
                return 0
            } else {
                // modernAverage <= traditionalAverage <= veryModernAverage
                return 2
            }
        } else {
            // now we know that veryModernAverage <= modernAverage
            if (traditionalAverage >= modernAverage) {
                // veryModernAverage <= modernAverage <= traditionalAverage
                return 0
            } else {
                // veryModernAverage <= traditionalAverage <= modernAverage
                return 1
            }
        }
    }
    function computePopularityRatio(years) {
        var totalBirths = 0;
        var totalNameBirths = 0;
        for (let [year, data] of years) {
            if (data != null) {
                totalNameBirths += data.data.count
                totalBirths += data.totalBirths;
            }
        }
        if (totalBirths == 0) return 0;
        return totalNameBirths / totalBirths;
    }
    function determinePopularityLevel(ratio) {
        if (ratio >= 0.1) {
            return 0
        } else if (ratio >= 1/500) {
            return 1
        } else if (ratio >= 1/1000) {
            return 2;
        } else if (ratio >= 1/3000) {
            return 3
        } else if (ratio >= 1/10000) {
            return 4;
        } else {
            return 5;
        }
    }
    function formatPopularityLevel(ratio) {
        let meta = Metadata.assumeLoaded();
        if (ratio >= 1/1000) {
            return `about ${Math.ceil(ratio*1000)} in a thousand`
        } else if (ratio >= 1/10000) {
            return `about ${Math.ceil(ratio*10000)} in ten thousand`
        } else if (ratio >= 1.0e-6) {
            return `about ${Math.ceil(ratio*10e6)} in a million`
        } else if (ratio >= 10e-9) {
            return `about ${Math.ceil(ratio*10e9)} in a billion`
        } else if (ratio == 0) {
            return `missing from ${meta.currentYear} data`
        } else {
            return `(internal error: invalid ratio ${ratio})`
        }
    }
    function currentStartYear() {
        var rawYear = $("#startYear").val();
        const meta = Metadata.assumeLoaded();
        console.log(`Raw startYear ${rawYear}`);
        if (rawYear == "") {
            rawYear = meta.defaultStartYear.toString();
        }
        var year = Number.parseInt(rawYear);
        console.log(`Parsed year ${year} from ${rawYear}`)
        if (!Number.isNaN(year) && year >= meta.minimumYear && year <= meta.currentYear) {
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
            let rank_str = data.rank != null ? `#${data.rank}` : "None";
            table.append(`<tr>
                <th scope="row">${year}</th>
                <td>${rank_str}</th>
                <td>${data.count}</td>
            </tr>`)
        }
    }
    $("#targetNameForm").on('submit', function(event) {
        console.log(`Submitted ${currentName()}`);
        $("#loadButton").trigger('click');
        event.preventDefault();
    })
    var nameChart = null;
    var similarityWorker = null;
    $("#loadButton").on('click', function() {
        console.log("Clicked");
        const meta = Metadata.requireLoaded("load name data");
        if (meta == null) return; // gave the message
        const name = currentName();
        const startYear = currentStartYear();
        if (startYear == null) return;
        const years = [...Array(meta.currentYear - startYear + 1).keys()].map(i => i + startYear);
        $("#maleNameHeader").text(`Males named '${name}'`);
        $("#femaleNameHeader").text(`Females named '${name}'`);
        $("#similarNameHeader").text(`Names similar to '${name}'`);
        $("#maleNameSpinner").addClass("fa fa-spinner fa-spin");
        $("#femaleNameSpinner").addClass("fa fa-spinner fa-spin");
        $("#similarNameSpinner").addClass("fa fa-spinner fa-spin");
        $("#verdictSpinner").addClass("fa fa-spinner fa-spin")
        var similarNameList = $("#similarNames");
        var maleNameTable = $("#maleNameTableBody");
        var femaleNameTable = $("#femaleNameTableBody");
        similarNameList.empty();
        maleNameTable.empty();
        femaleNameTable.empty();
        $("#verdictList").empty();
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
        // Request known names and run similarity worker
        new ListKnownNamesRequest().run(function(knownNames) {
            if (similarityWorker !== null) throw new Error(`Expected null but got ${similarityWorker}`);
            similarityWorker = new Worker('worker.js');
            similarityWorker.postMessage({knownNames: knownNames, targetName: name})
            similarityWorker.onmessage = function(e) {
                const similarNames = e.data.similarNames;
                console.log(`Determined similar names of ${similarNames.map(name => name.name)}`);
                $("#similarNameSpinner").removeClass();            
                for (let similarName of similarNames) {
                    similarNameList.append(`<li>${similarName.name}</li>`);
                }
            };

        })
        // Proceed to run the main request
        let request = new NameRequest(currentName(), years);
        request.run(function(response) {
            //console.log(`Received response years ${debugMap(response.years)}`)
            $("#maleNameSpinner").removeClass();
            $("#femaleNameSpinner").removeClass();
            var maleBirthData = [];
            var femaleBirthData = [];
            for (let [year, data] of response.years) {
                if (data.male.data == null) {
                    maleBirthData.push(0);
                } else {
                    maleBirthData.push(data.male.data.count);
                }
                if (data.female.data == null) {
                    femaleBirthData.push(0);
                } else {
                    femaleBirthData.push(data.female.data.count);
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
                                max: meta.currentYear
                            }
                        }]
                    }
                }
            });
            var male_data = new Array();
            var female_data = new Array();
            var maleMap = new Map();
            var femaleMap = new Map();
            for (let [year, data] of response.years) {
                male_data.push(data.male.data);
                female_data.push(data.female.data);
                maleMap.set(year, data.male);
                femaleMap.set(year, data.female);
            }
            $("#verdictSpinner").removeClass();
            console.log(`Typical gender ${response.typicalGender}`)
            if (response.typicalGender == null) {
                $("#verdictList").append(`<li>${name} is so uncommon, social security does not list it. `
                + `This name either <b>does not exist</b> or has less than 5 births a year and is hidden for privacy reasons.</li>`);
                $("#verdictList").append(`<li>This only includes officially registered births in the United States, so all immigrants `
                + `(even legal ones) are excluded from the statistics</li>`)
            } else {
                const peak = response.peak[response.typicalGender];
                console.log(`peak year for ${response.typicalGender} ${name} is ${peak}`);
                var peakPopularityLevel, currentPopularityLevel, era, peakRatio, currentRatio, genderName, genderRatioMsg;
                switch (response.typicalGender) {
                    case 'male': {
                        peakRatio = maleMap.get(peak).ratio;
                        peakPopularityLevel = determinePopularityLevel(peakRatio);
                        currentRatio = maleMap.get(meta.currentYear)?.ratio ?? 0;
                        currentPopularityLevel = determinePopularityLevel(currentRatio);
                        era = determineEra(peak, maleMap);
                        genderName = "boy";
                        genderRatioMsg = `${Math.floor(response.genderRatio * 100)}% male`;
                        break;
                    }
                    case 'female': {
                        peakRatio = femaleMap.get(peak).ratio;
                        peakPopularityLevel = determinePopularityLevel(peakRatio);
                        currentRatio = femaleMap.get(meta.currentYear)?.ratio ?? 0;
                        currentPopularityLevel = determinePopularityLevel(currentRatio);
                        era = determineEra(peak, femaleMap);
                        genderName = "girl";
                        genderRatioMsg = `${Math.floor(response.genderRatio * 100)}% female`;
                        break;
                    }
                    default:
                        // TODO: This isn't politically correct
                        console.error(`Invalid gender ${response.typicalGender}`);
                        throw new Error(`Invalid gender ${response.typicalGender}`);
                }
                console.log(`Determined peak ratio ${peakRatio} at level ${peakPopularityLevel}`);
                console.log(`Determined current ratio ${currentRatio} at level ${currentPopularityLevel}`);
                console.log(`Determined era ${era} named ${ERA_NAMES[era]}`);
                var peakPopularityName = `${POPULARITY_LEVEL_NAMES[peakPopularityLevel]} name (${formatPopularityLevel(peakRatio)})`;
                var currentPopularityName = `${POPULARITY_LEVEL_NAMES[currentPopularityLevel]} name (${formatPopularityLevel(currentRatio)})`;
                $("#verdictList").append(`<li>${name} is typically a ${genderName} name (${genderRatioMsg})</li>`);
                $('#verdictList').append(`<li>At its peak in ${peak}, ${name} was a ${peakPopularityName}.</li>`);
                $('#verdictList').append(`<li>Nowadays, ${name} is a ${currentPopularityName}.</li>`);
                $('#verdictList').append(`<li>${name} is a ${ERA_NAMES[era]} name.</li>`)

            }
            appendAverageRow(maleNameTable, male_data);
            appendAverageRow(femaleNameTable, female_data)
            for (let [year, data] of response.years) {
                appendNameRow(maleNameTable, year, data.male.data);
                appendNameRow(femaleNameTable, year, data.female.data);
            }

        })
    })
});
