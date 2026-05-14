const hydianRebellion = {
    "id": "hydian_rebellion",
    "name": "The Hydian Rebellion",
    "baseEra": "2695",
    "centerCoords": [
        7160,
        5003
    ],
    "startDate": "2695.03.12",
    "endDate": "2696.11.20",
    "participants": [
        "United Systems",
        "Independent"
    ],
    "desc": "This is a test conflict. NON-CANON.",
    "events": [
        {
            "type": "movement",
            "date": "2695.04.05",
            "name": "1st Fleet Deployment",
            "faction": "United Systems",
            "path": [
                "α Hydia",
                "δ Hydia",
                "β Hydia"
            ],
            "desc": "The 1st Fleet deploys from the core, pushing into the Meridian gateway."
        },
        {
            "type": "multi_movement",
            "date": "2695.06.10",
            "name": "Convergence on Argo",
            "desc": "United Systems forces push from Meridian while Independent rebel fleets rush from the New Colonies to intercept them at Argo.",
            "fleets": [
                {
                    "faction": "United Systems",
                    "path": [
                        "β Hydia",
                        "Nova Sol"
                    ]
                },
                {
                    "faction": "Independent",
                    "path": [
                        "Lemnos",
                        "Nova Sol"
                    ]
                }
            ]
        },
        {
            "type": "battle",
            "date": "2695.06.14",
            "name": "Siege of Nova Sol",
            "system": "Nova Sol",
            "faction": "Independent",
            "desc": "Rebel forces ambush the 1st Fleet as it attempts to secure the Nova Sol system. The resulting battle leaves the system heavily contested."
        },
        {
            "type": "summary",
            "date": "2696.01.01",
            "name": "2695 Year-End Summary",
            "desc": "The first year of the rebellion concludes in a bloody stalemate around the Argoic Cluster. Both sides dig in, establishing fortified lines as the conflict promises to drag into a second year."
        },
        {
            "type": "battle",
            "date": "2696.02.14",
            "name": "Battle of Colchis",
            "system": "Colchis",
            "faction": "United Systems",
            "desc": "Battle at Colchis"
        }
    ]
};