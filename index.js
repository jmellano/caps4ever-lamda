var config = require('./config.json');
var rp = require('request-promise');

/**
 * Récupère les stats du clan
 * Se base sur les informations du clan
 * et sur les logs des précédentes guerre
 * pour en déduire un classement
 */
async function retrieveClanWarStats() {
    const clanInfos = await retrieveClanInformations();
    const clanWarLog = await retrieveClanWarLog(clanInfos);


    var stats={};

    stats.donations_ranking = clanInfos.members;
    stats.war_ranking = [];
    for (var [seasonNum, seasonStats] of clanWarLog) {
        stats.war_ranking.push({
            season : seasonStats.season,
            ranking : seasonStats.memberArray
        });
    }

    return stats;
}


/**
 * récupère les informations (dont les membres) à un instant t sur le clan
 */
async function retrieveClanInformations() {
    var options = {
        json: true,
        uri: config.API.url + "/clan/" + config.API.clantag,
        headers: {
            'auth': config.API.token
        },
        json: true // Automatically parses the JSON string in the response
    };

    return rp(options)
        .then(function (clanInfos) {
            return clanInfos;
        })
        .catch(function (err) {
            return err;
            // API call failed...
        });

};

async function retrieveClanWarLog(infos) {
    function afficherClanInfos(data) {
        var playerMap = new Map();

        data.members.sort(compareDonations);

        for (var member of data.members) {
            playerMap.set(member.tag, {
                'name': member.name,
                'role': member.role,
                'donations': member.donations
            })
        }
    }

    afficherClanInfos(infos);

    var options = {
        json: true,
        uri: config.API.url + "/clan/" + config.API.clantag + '/warlog',
        headers: {
            'auth': config.API.token
        },
        json: true // Automatically parses the JSON string in the response
    };

    return rp(options)
        .then(function (clanwarlog) {
            console.log('Clan WarLog : ');
            return afficherClanWarLog(clanwarlog, infos)
        })
        .catch(function (err) {
            console.log("Erreur : " + err);
            // API call failed...
        });

    function afficherClanWarLog(clanwarlog, clansInformations) {
        // console.log(clanwarlog);
        // 1. On regroupe les informations par saison
        // 2. On récupère le nb de carte gagnées par joueur
        // 3. On récupère les victoires
        // 4. On identifie les membres qui n'ont pas participé au jour de guerre alors qu'ils s'étaient engagés
        // 5. On identifie les membres qui n'ont pas participé à la guerre tout court
        // NB : impossible avec la version actuelle d'identifier une personne ayant 2 batailles et n'en n'ayant fait qu'une
        // Compliqué de trouvé les batailles de jour de collection

        var seasonWars = new Map();

        function regrouperParSaison() {
            function defaultSeasonInitialisation(war) {
                return {
                    'season': war.seasonNumber,
                    'ranking': null,
                    'wars': [],
                    'members': new Map()
                }

            }

            for (var war of clanwarlog) {
                var previouswars = seasonWars.get(war.seasonNumber) || defaultSeasonInitialisation(war);
                previouswars.wars.push(war);
                seasonWars.set(war.seasonNumber, previouswars);
            }
        }

        function recupererInformationsSaison(clansInformations) {
            function defaultParticipantSeasonData(participant) {
                return {
                    'name': participant.name,
                    'tag': participant.tag,
                    'cardsEarned': 0,
                    'battlesPlayed': 0,
                    'wins': 0,
                    'warDayNotPlayed': 0,
                    'CollectionBattleNotPlayed': 0,
                    'score': 0
                }
            }

            function addParticipantWarInformation(previousParticipantData, participant) {
                return {
                    'name': previousParticipantData.name,
                    'tag': previousParticipantData.tag,
                    'cardsEarned': previousParticipantData.cardsEarned + participant.cardsEarned,
                    'battlesPlayed': previousParticipantData.battlesPlayed + participant.battlesPlayed,
                    'wins': previousParticipantData.wins + participant.wins,
                    'warDayNotPlayed': previousParticipantData.warDayNotPlayed + participant.battlesPlayed == 0 ? 1 : 0,
                    'CollectionBattleNotPlayed': 0,
                    'warNotPlayed': 0,
                    score: 0
                }
            }

            function compareScore(a, b) {
                if (a.score < b.score)
                    return 1;
                if (a.score > b.score)
                    return -1;
                return 0;
            }


            function evaluateParticipantScore(season) {
                var memberArray = Array.from(season.members.values());
                for (var member of memberArray) {
                    member.score = member.cardsEarned * 1 +
                        member.wins * 500 -
                        member.warDayNotPlayed * 1500 -
                        member.CollectionBattleNotPlayed * 250 -
                        member.warNotPlayed * 100;
                }
                season.memberArray = memberArray;
                return season;

            }

            /**
             * Retrouve par une intersection les membres du clan qui n'ont pas participé à la guerre
             * et ajoute 1 au champ `warNotPlayed`
             *
             * Le hic ==> il ne prend pas en compte l'arrivée du membre car on a
             * ni sa date d'entrée ni la date début/fin de la guerre
             *
             * @param clanMembers
             * @param warParticipant
             * @param seasonParticipants
             * @returns {*}
             */
            function addMissingParticipant(clanMembers, warParticipant, seasonParticipants) {
                return seasonParticipants;
            }

            for (var [seasonNumber, season] of seasonWars) {
                for (var war of season.wars) {
                    for (var participant of war.participants) {
                        var previousParticipantData = season.members.get(participant.tag) || defaultParticipantSeasonData(participant);
                        previousParticipantData = addParticipantWarInformation(previousParticipantData, participant);
                        season.members.set(participant.tag, previousParticipantData);
                    }
                    season.members = addMissingParticipant(clansInformations.members, war.participants, season.members);
                }

                season = evaluateParticipantScore(season);
                season.memberArray.sort(compareScore)
            }
        }
        regrouperParSaison();
        recupererInformationsSaison(clansInformations);

        return seasonWars;

    }
}

function compareDonations(a, b) {
    if (a.donations < b.donations)
        return 1;
    if (a.donations > b.donations)
        return -1;
    return 0;
}


exports.clanInfos = (event, context, callback) => {
    retrieveClanInformations().then(function (clanInfos) {
        clanInfos.members.sort(compareDonations);
        var response = {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Origin":"*"
            },
            "body": JSON.stringify(clanInfos),
            "isBase64Encoded": false
        };
        callback(null, response);
    });
};

exports.clanWarStats = (event, context, callback) => {
    retrieveClanWarStats().then(function(clanStat) {
        var response = {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
                "Access-Control-Allow-Origin":"*"
            },
            "body": JSON.stringify(clanStat),
            "isBase64Encoded": false
        };
        callback(null, response);
    });
};
