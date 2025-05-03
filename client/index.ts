(function() {
    "use strict";
    // NOTE: We expect to be deferred, so the dom should be loaded
    console.assert(document.readyState !== "loading", `Unexpected document state: ${document.readyState}`);
    type Gender = "male" | "female";
    interface GenderedData<T> {
        male: T;
        female: T;
    }
    class NameData {
        gender: Gender;
        rank: number;
        count: number;
        constructor(gender: Gender, rank: number, count: number) {
            this.gender = gender;
            this.rank = rank;
            this.count = count;
        }
        static parse(data: any): NameData {
            return new NameData(
                data['gender'],
                data['rank'],
                data['count']
            );
        }
    }
    class YearResponse {
        totalBirths : number;
        data: NameData;
        ratio: number;
        constructor(totalBirths: number, data: NameData, ratio: number) {
            this.totalBirths = totalBirths;
            this.data = data;
            this.ratio = ratio;
        }
        static parse(data: any) {
            return new YearResponse(
                data['total_births'],
                NameData.parse(data['data']),
                data['ratio']
            );
        }
    }
    class YearData {
        male: YearResponse;
        female: YearResponse;
        constructor(male: YearResponse, female: YearResponse) {
            this.male = male;
            this.female = female;
        }
        static parse(data: any) {
            return new YearData(
                YearResponse.parse(data['male']),
                YearResponse.parse(data['female'])
            );
        }
    }
    class NameResponse {
        years: Map<number, YearData>;
        peak: GenderedData<number>;
        typicalGender: Gender;
        genderRatio: number;

        constructor(years: Map<number, YearData>, peak: GenderedData<number>, typicalGender: Gender, genderRatio: number) {
            this.years = years;
            this.peak = peak;
            this.typicalGender = typicalGender;
            this.genderRatio = genderRatio;
        }

        static parse(data: any) {
            let years = new Map()
            Object.entries(data["years"]).forEach(function(entry) {
                let year = Number.parseInt(entry[0]);
                let data = YearData.parse(entry[1]);
                years.set(year, data);
            });
            return new NameResponse(years, data["peak"], data["typical_gender"], data["gender_ratio"])
        }
    }
    class NameRequest {
        name: string;
        years: number[];
        constructor(name: string, years: number[]) {
            this.name = name;
            this.years = years;
        }
        get json() {
            return {
                name: this.name,
                years: this.years
            }
        }
        async run(): Promise<NameResponse> {
            console.log(`Running request ${JSON.stringify(this.json)}`);
            let response = await fetch("api/load", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(this.json),
            });
            return NameResponse.parse(await response.json());
        }
    }
    interface KnownYearsResponse {
        latest_year: number;
        earliest_year: number;
    }
    class ListKnownYearsRequest {
        constructor() {}
        async run(): Promise<KnownYearsResponse> {
            let response = await fetch("api/known_years");
            return await response.json();
        }
    }
    class ListKnownNamesRequest {
        constructor() {}
        async run(): Promise<string[]> {
            let response = await fetch("api/known_names");
            return await response.json();
        }
    }

    class Metadata {
        readonly currentYear: number;
        readonly minimumYear: number;
        readonly defaultStartYear: number;
        constructor(yearResponse: KnownYearsResponse) {
            this.currentYear = yearResponse.latest_year;
            this.minimumYear = yearResponse.earliest_year;
            if (!Number.isInteger(this.currentYear)) throw new Error(`Invalid 'latest_year': ${yearResponse.latest_year}`);
            console.assert(Number.isInteger(this.minimumYear), "Invalid `earliest_year`");
            this.defaultStartYear = 1940;
            Object.freeze(this);
        }
        static INSTANCE: Metadata | null = null;
        static requireLoaded(action: string): Metadata | null {
            if (this.INSTANCE === null) {
                alert(`Can not ${action} while initial metadata is loading`);
                return null;
            } else {
                return this.INSTANCE;
            }
        }
        static assumeLoaded(): Metadata {
            if (this.INSTANCE === null) {
                throw new Error("Expected metadata to already be loaded!");
            }
            return this.INSTANCE;
        }
    }
    new ListKnownYearsRequest().run().then((response) => {
        console.assert(Metadata.INSTANCE === null, "Already initialized metadata");
        const meta = new Metadata(response);
        Metadata.INSTANCE = meta;
        console.assert(meta.minimumYear === 1880, `Unexpected minimum year ${meta.minimumYear}`);
        document.getElementById("yearRangeMessage")!!.innerText = `Includes data from ${meta.minimumYear} to ${meta.currentYear}`;
        {
            let startYear = document.getElementById("startYear")!!;
            startYear.setAttribute("min", String(meta.minimumYear));
            startYear.setAttribute("max", String(meta.currentYear));
            startYear.setAttribute("placeholder", String(meta.defaultStartYear));
        }
        console.log("Finished initalizing metadata");
    })
    // One of Benjamin's original obsessive names (besides the last name Shemermino)
    const DEFAULT_NAME = "Salvatore";
    function currentName(): string {
        let name = document.getElementById("targetName")!!.textContent!!;
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
    function averageCount(data: YearResponse[]): number{
        let sum = 0;
        console.log(`Data ${data}`);
        for (let element of data) {
            if (element.data != null) {
                sum += element.data.count;
            }
        }
        return sum / data.length;
    }
    function filterValues<K, V>(map: Map<K, V>, func: (key: K) => boolean): V[] {
        return Array.from(map.entries())
            .filter(([key, _value]) => func(key))
            .map(([_key, value]) => value);
    }
    function determineEra(peak: number, years: Map<number, YearResponse>): number {
        const SIGNIFICANCE_RATIO = .2;
        const SIGNIFICANCE_THRESHOLD = 500;
        const peakValue = years.get(peak)!!.totalBirths;
        const traditionalYears = filterValues(years, (year) => year < 1960);
        const modernYears = filterValues(years, (year) => year >= 1960 && year < 2000);
        const veryModernYears = filterValues(years, (year) => year >= 2000);
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
    function determinePopularityLevel(ratio: number): number {
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
    function formatPopularityLevel(ratio: number): string {
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
    function currentStartYear(): number | null {
        let startYearElement = document.getElementById("startYear")!!;
        let rawYear = startYearElement!!.textContent!!;
        const meta = Metadata.assumeLoaded();
        console.log(`Raw startYear ${rawYear}`);
        if (rawYear == "") {
            rawYear = meta.defaultStartYear.toString();
        }
        let year = Number.parseInt(rawYear);
        console.log(`Parsed year ${year} from ${rawYear}`)
        if (!Number.isNaN(year) && year >= meta.minimumYear && year <= meta.currentYear) {
            return year
        }
        startYearElement.textContent = '';
        alert(`Invalid year '${rawYear}'`);
        return null;
    }
    function appendAverageRow(table: Element, data_list: NameData[]) {
        let total_births = 0;
        let total_ranks = 0;
        let valid_entries = 0;
        for (let data of data_list) {
            if (data != null) {
                total_births += data.count;
                total_ranks += data.rank;
                valid_entries += 1;
            }
        }
        let createdTable = document.createElement("tr");
        createdTable.className = "table-primary";
        {
            let headerRow = document.createElement("th");
            headerRow.scope = "row";
            headerRow.innerText = "Average";
            createdTable.append(headerRow);
        }
        function appendRow(text: string): void {
            let row = document.createElement("td");
            row.innerText = text;
            createdTable.append(row);
        }
        if (valid_entries > 0) {
            let average_births = Math.ceil(total_births / valid_entries);
            let average_rank = Math.round(total_ranks / valid_entries);
            appendRow(`#${average_rank}`);
            appendRow(String(average_births));
        } else {
            appendRow("None");
            appendRow("0");
        }
        table.append(createdTable);
    }
    function appendNameRow(table: Element, year: number, data: NameData): void {
        let createdTable = document.createElement("tr");
        {
            let headerRow = document.createElement("th");
            headerRow.scope = "row";
            headerRow.innerText = String(year);
            createdTable.append(headerRow);
        }
        function appendRow(text: string): void {
            let row = document.createElement("td");
            row.innerText = text;
            createdTable.append(row);
        }
        if (data == null) {
            appendRow("None");
            appendRow("0");
        } else {
            let rank_str = data.rank != null ? `#${data.rank}` : "None";
            appendRow(rank_str);
            appendRow(String(data.count));
        }
        table.append(createdTable);
    }
    document.getElementById("targetNameForm")?.addEventListener('submit', (event) => {
        console.log(`Submitted ${currentName()}`);
        document.getElementById("loadButton")?.click();
        event.preventDefault();
    })
    let nameChart: Chart | null = null;
    let similarityWorker: Worker | null = null;
    document.getElementById("loadButton")?.addEventListener("click", (_event)  => {
        console.log("Clicked");
        const meta = Metadata.requireLoaded("load name data");
        if (meta == null) return; // gave the message
        const name = currentName();
        const startYear = currentStartYear();
        if (startYear == null) return;
        const years = [...Array(meta.currentYear - startYear + 1).keys()].map(i => i + startYear);
        document.getElementById("maleNameHeader")!!.innerText = `Males named '${name}'`;
        document.getElementById("femaleNameHeader")!!.innerText = `Females named '${name}'`;
        document.getElementById("similarNameHeader")!!.innerText = `Names similar to '${name}'`;
        {
            function activateSpinner(tgt: Element): void {
                tgt.classList.add("fa", "fa-spinner", "fa-spin");
            }
            activateSpinner(document.getElementById("maleNameSpinner")!!);
            activateSpinner(document.getElementById("femaleNameSpinner")!!);
            activateSpinner(document.getElementById("similarNameSpinner")!!);
            activateSpinner(document.getElementById("verdictSpinner")!!);
        }
        let similarNameList = document.getElementById("similarNames")!!;
        let maleNameTable = document.getElementById("maleNameTableBody")!!;
        let femaleNameTable = document.getElementById("femaleNameTableBody")!!;
        similarNameList.replaceChildren();
        maleNameTable.replaceChildren();
        femaleNameTable.replaceChildren();
        document.getElementById("verdictList")!!.replaceChildren();
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
            let newCanvas = document.createElement("canvas");
            newCanvas.id = "nameChart";
            newCanvas.width = 100;
            newCanvas.height = 100;
            document.getElementById("nameChartDiv")?.replaceChildren(newCanvas);
        }
        if (similarityWorker !== null) {
            similarityWorker.terminate();
            similarityWorker = null;
        }
        // Request known names and run similarity worker
        new ListKnownNamesRequest().run().then((knownNames) => {
            if (similarityWorker !== null) throw new Error(`Expected null but got ${similarityWorker}`);
            similarityWorker = new Worker('js/worker.js');
            interface WorkerResponse {
                similarNames: { name: string }[];
            }
            similarityWorker.postMessage({knownNames: knownNames, targetName: name})
            similarityWorker.onmessage = function(e: MessageEvent<WorkerResponse>) {
                const similarNames = e.data.similarNames;
                console.log(`Determined similar names of ${similarNames.map(name => name.name)}`);
                document.getElementById("similarNameSpinner")!!.className = "";
                for (let similarName of similarNames) {
                    let item = document.createElement("li");
                    item.innerText = similarName.name;
                    similarNameList.append(item);
                }
            };

        })
        // Proceed to run the main request
        let request = new NameRequest(currentName(), years);
        request.run().then((response) => {
            //console.log(`Received response years ${debugMap(response.years)}`)
            document.getElementById("maleNameSpinner")!!.className = "";
            document.getElementById("femaleNameSpinner")!!.className = "";
            let maleBirthData = [];
            let femaleBirthData = [];
            for (let [_year, data] of response.years) {
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
            if (nameChart !== null) throw new Error(`Expected null but got ${nameChart}`);
            nameChart = new Chart(document.getElementById("nameChart") as HTMLCanvasElement, {
                type: 'line',
                data: {
                    labels: years.map(String),
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
            let male_data: NameData[] = [];
            let female_data: NameData[] = [];
            let maleMap = new Map<number, YearResponse>();
            let femaleMap = new Map<number, YearResponse>();
            for (let [year, data] of response.years) {
                male_data.push(data.male.data);
                female_data.push(data.female.data);
                maleMap.set(year, data.male);
                femaleMap.set(year, data.female);
            }
            document.getElementById("verdictSpinner")!!.className = "";
            console.log(`Typical gender ${response.typicalGender}`)
            if (response.typicalGender == null) {
                let verdictList = document.getElementById("verdictList")!!;
                let firstItem = document.createElement("li");
                firstItem.innerHTML = `${document.createTextNode(name)} is so uncommon, social security does not list it. `
                    + `This name either <b>does not exist</b> or has less than 5 births a year and is hidden for privacy reasons.`;
                let secondItem = document.createElement("li");
                secondItem.innerText = `This only includes officially registered births in the United States, so all immigrants `
                    + `(even legal ones) are excluded from the statistics`;
                verdictList.append(firstItem);
                verdictList.append(secondItem);
            } else {
                const peak = response.peak[response.typicalGender];
                console.log(`peak year for ${response.typicalGender} ${name} is ${peak}`);
                let peakPopularityLevel: number, currentPopularityLevel: number, era: number, peakRatio: number, currentRatio: number, genderName: string, genderRatioMsg: string;
                switch (response.typicalGender) {
                    case 'male': {
                        peakRatio = maleMap.get(peak)!!.ratio;
                        peakPopularityLevel = determinePopularityLevel(peakRatio);
                        currentRatio = maleMap.get(meta.currentYear)?.ratio ?? 0;
                        currentPopularityLevel = determinePopularityLevel(currentRatio);
                        era = determineEra(peak, maleMap);
                        genderName = "boy";
                        genderRatioMsg = `${Math.floor(response.genderRatio * 100)}% male`;
                        break;
                    }
                    case 'female': {
                        peakRatio = femaleMap.get(peak)!!.ratio;
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
                let peakPopularityName = `${POPULARITY_LEVEL_NAMES[peakPopularityLevel]} name (${formatPopularityLevel(peakRatio)})`;
                let currentPopularityName = `${POPULARITY_LEVEL_NAMES[currentPopularityLevel]} name (${formatPopularityLevel(currentRatio)})`;
                {
                    let verdictList = document.getElementById("verdictList")!!;
                    function appendListItem(text: string): void {
                        let item = document.createElement("li");
                        item.innerText = text;
                        verdictList.append(item);
                    }

                    appendListItem(`${name} is typically a ${genderName} name (${genderRatioMsg})`);
                    appendListItem(`At its peak in ${peak}, ${name} was a ${peakPopularityName}.`);
                    appendListItem(`Nowadays, ${name} is a ${currentPopularityName}.`);
                    appendListItem(`${name} is a ${ERA_NAMES[era]} name.`)
                }
            }
            appendAverageRow(maleNameTable, male_data);
            appendAverageRow(femaleNameTable, female_data)
            for (let [year, data] of response.years) {
                appendNameRow(maleNameTable, year, data.male.data);
                appendNameRow(femaleNameTable, year, data.female.data);
            }

        })
    })
})()