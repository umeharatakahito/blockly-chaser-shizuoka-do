/**
 * 対戦画面(ホスト)。
 *
 * ルームに match_init で試合を用意し、cool / hot それぞれの iframe に
 * プログラムを読ませ、両方そろったら match_start で始める。
 *
 * クエリ:
 *   room_id    マップ(ルーム)の ID
 *   room_token 合言葉。同じ合言葉の人だけが同じ試合に入る
 *   bot        ボット対戦のレベル (1〜30)。hot がボットになる
 *   ghost      ゴースト対戦の記録 ID。cool がゴーストになる
 */

var socket = io();
var query_list = {};
var query = location.search.replace("?", "").split('&');
var check_timer;
var c_name = "NoName";
var h_name = "NoName";
var load_map_size_x;
var load_map_size_y;
var temp_msg;
var key;
var full_room_id;
var mode = "vs";

window.onload = function () {
    //document.getElementsByTagName("body")[0].classList.add("animation_stop");
};

for (parameters of query) {
    var qp = parameters.split('=');
    if (qp.length == 2) {
        query_list[qp[0]] = decodeURIComponent(qp[1]);
    }
}

if (query_list.bot) mode = "bot";
else if (query_list.ghost) mode = "ghost";

var menu_path = { vs: "/vs", bot: "/bot", ghost: "/ghost" }[mode];
document.addEventListener("DOMContentLoaded", function () {
    var back = document.getElementById("back_link");
    if (back) back.href = menu_path;
});

if (!query_list.room_token) query_list.room_token = "no_token";
full_room_id = query_list.room_id + "?" + query_list.room_token;

if (query_list.room_id) {
    var url = './../api/game?room_id=' + query_list.room_id;
    fetch(url)
        .then(function (data) {
            return data.json();
        })
        .then(function (json) {
            if (json) {
                socket.emit('looker_join', full_room_id);
                document.getElementById('server_name').textContent = String(json.name);
                var buttle_mode = "";
                if (mode == "bot") buttle_mode = "（ボット L" + query_list.bot + "）";
                else if (mode == "ghost") buttle_mode = "（ゴースト）";
                else if (json.cpu) buttle_mode = "（テスト）";
                document.title += " - " + document.getElementById('server_name').textContent + buttle_mode;

                var server_init = { room_id: full_room_id };
                if (mode == "bot") server_init.bot = { level: Number(query_list.bot) };
                if (mode == "ghost") server_init.ghost = { id: query_list.ghost };
                socket.emit("match_init", server_init);
            }
            else {
                document.getElementById('server_name').textContent = "存在しないサーバー";
            }
        });
}

var match_start_check = function () {
    socket.emit("match_start_check");
};
var check_flag = true;

/** 片側の iframe を用意する。CPU 側はプログラムを読まない表示だけの画面にする */
function setupSide(chara, isCpu) {
    var iframe = document.getElementById(chara + '_player_iframe');
    if (isCpu) {
        var label = chara == "cool" ? c_name : h_name;
        iframe.src = "/match/cpu?side=" + chara + "&name=" + encodeURIComponent(label);
        return;
    }
    iframe.src = "/match/player?room_id=" + encodeURIComponent(query_list.room_id)
        + "&room_token=" + encodeURIComponent(query_list.room_token)
        + "&chara=" + chara + "&key=" + encodeURIComponent(key);
}

socket.on("match_init_rec", function (msg) {
    if (!msg.error) {
        key = msg.key;
        setupSide("cool", msg.cool_cpu);
        setupSide("hot", msg.hot_cpu);

        document.getElementById("game_start").onclick = function () {
            check_flag = false;
            clearInterval(check_timer);
            document.getElementById('ready_area').classList.add("display_off");
            document.getElementById('game_area').classList.remove("display_off");
            socket.emit("match_start", { "room_id": full_room_id, "key": key });
        }
        check_flag = true;
        check_timer = setInterval(match_start_check, 500);
    }
    else {
        window.alert(msg.error);
        window.location.href = menu_path;
    }
});

socket.on("match_start_check_rec", function (msg) {
    var game_start_button = document.getElementById('game_start');
    if (check_flag) {
        if (msg) {
            if (!game_start_button.classList.contains("display_on")) {
                game_start_button.classList.add("display_on");
            }
        }
        else {
            if (game_start_button.classList.contains("display_on")) {
                game_start_button.classList.remove("display_on");
            }
        }
    }
});

socket.on("joined_room", function (msg) {
    load_map_size_x = msg.x_size;
    load_map_size_y = msg.y_size;
    if (msg.cool_name) {
        c_name = msg.cool_name;
    }
    if (msg.hot_name) {
        h_name = msg.hot_name;
    }
    if (msg.cpu_name) {
        h_name = msg.cpu_name;
    }
    // CPU 側の表示名は後から届くことがあるので、そのたびに更新する
    var cpuFrames = document.querySelectorAll('.player_iframe');
    cpuFrames.forEach(function (f) {
        if (f.src.indexOf('/match/cpu') !== -1) {
            var side = f.id.indexOf('cool') === 0 ? 'cool' : 'hot';
            var label = side == 'cool' ? c_name : h_name;
            var next = "/match/cpu?side=" + side + "&name=" + encodeURIComponent(label);
            if (f.getAttribute('src') !== next) f.src = next;
        }
    });
});

socket.on("updata_board", function (msg) {
    clearInterval(check_timer);
    document.getElementById('ready_area').classList.add("display_off");
    document.getElementById('game_area').classList.remove("display_off");
    temp_msg = msg;
    if (msg.effect) {
        makeTable(msg, load_map_size_x, load_map_size_y, msg.effect, "game_board");
    }
    else {
        makeTable(msg, load_map_size_x, load_map_size_y, 0, "game_board");
    }
});

socket.on("new_board", function (msg) {
    temp_msg = msg;
    game_bgm_flag = true;
    if (msg.effect) {
        makeTable(msg, load_map_size_x, load_map_size_y, msg.effect, "game_board");
    }
    else {
        makeTable(msg, load_map_size_x, load_map_size_y, 0, "game_board");
    }
});

var game_result_msg = "";
var game_result_info = "";

socket.on("game_result", function (msg) {
    if (localStorage["SOUND_STATUS"]) {
        if (localStorage["SOUND_STATUS"] == "on") {
            gameBgm.stop();
            resultSound.play();
        }
    }
    else {
        gameBgm.stop();
        resultSound.play();
    }
    game_result_msg = msg.winer;
    game_result_info = msg.info;

    game_result_display(msg.winer, msg.info);

    socket.emit("match_end", { "room_id": full_room_id, "key": key });

    // ボットに勝ったら名前を残せる
    if (msg.record_id && msg.player_side && msg.winer == msg.player_side) {
        askName(msg.record_id, msg.record_name);
    }
});

socket.on("error", function (msg) {
    gameBgm.stop();
    if (typeof msg === "string" && msg) {
        var el = document.getElementById('server_name');
        if (el && el.textContent.indexOf(msg) === -1) el.textContent += "  [" + msg + "]";
    }
});

/* ------------------------------------------------------------ 名前の登録 */

function askName(recordId, autoName) {
    var overlay = document.getElementById("name_overlay");
    var input = document.getElementById("name_input");
    var error = document.getElementById("name_error");
    var submit = document.getElementById("name_submit");
    var skip = document.getElementById("name_skip");
    var text = document.getElementById("name_dialog_text");

    text.innerHTML = "この名前でランキングとゴーストに記録されます。<br>スキップすると「" + escapeHtml(autoName || "自動の名前") + "」になります。";
    overlay.classList.remove("display_off");
    input.value = localStorage["BOT_PLAYER_NAME"] || "";
    input.focus();

    function close() {
        overlay.classList.add("display_off");
    }

    skip.onclick = close;
    submit.onclick = function () {
        var name = input.value.trim();
        if (!name) { error.textContent = "名前を入れてください"; return; }
        submit.disabled = true;
        fetch("/records/name", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: recordId, name: name })
        }).then(function (r) { return r.json(); }).then(function (json) {
            submit.disabled = false;
            if (json.ok) {
                localStorage["BOT_PLAYER_NAME"] = name;
                close();
            } else {
                error.textContent = json.error || "登録できませんでした";
            }
        }).catch(function () {
            submit.disabled = false;
            error.textContent = "通信に失敗しました";
        });
    };
    input.onkeydown = function (e) {
        if (e.key === "Enter") submit.onclick();
    };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

/* ------------------------------------------------------------ 結果表示 */

function game_result_display(winer, info) {
    var old = document.getElementById("game_result");
    if (old) old.parentNode.removeChild(old);
    var oldInfo = document.getElementById("winer_info_div");
    if (oldInfo) oldInfo.parentNode.removeChild(oldInfo);

    var result = document.createElement("div");
    result.setAttribute("id", "game_result");
    var img = document.createElement('img');
    if (winer == "cool") {
        img.src = '/images/coolwin.png';
    }
    else if (winer == "hot") {
        img.src = '/images/hotwin.png';
    }
    else {
        img.src = '/images/draw.png';
    }
    result.appendChild(img);


    var back_button = document.createElement("div");
    var re_button = document.createElement("div");

    back_button.setAttribute("id", "back_button");
    re_button.setAttribute("id", "re_button");

    var back_button_link = document.createElement('a');
    back_button_link.classList.add("button_link");
    back_button_link.href = menu_path;
    back_button_link.innerText = "戻る";
    back_button.appendChild(back_button_link);

    var re_button_link = document.createElement('a');
    re_button_link.classList.add("button_link");
    re_button_link.href = location.pathname + location.search;
    re_button_link.innerText = "もう一度";
    re_button.appendChild(re_button_link);

    result.appendChild(back_button);
    result.appendChild(re_button);

    document.getElementById("game_board").appendChild(result);


    var winer_info_div = document.createElement("div");
    winer_info_div.setAttribute("id", "winer_info_div");

    var twiner_info = document.createElement("div");
    twiner_info.setAttribute("id", "winer_info_title");
    twiner_info.appendChild(document.createTextNode("リザルト情報"));

    var winer_info = document.createElement("div");
    winer_info.setAttribute("id", "winer_info");
    winer_info.appendChild(document.createTextNode(info));

    winer_info_div.appendChild(twiner_info);
    winer_info_div.appendChild(winer_info);

    var infoArea = document.getElementById("game_info_div") || document.getElementById("game_info");
    infoArea.appendChild(winer_info_div);

}

window.addEventListener("resize", function () {
    if (temp_msg) {
        if (temp_msg.effect) {
            makeTable(temp_msg, load_map_size_x, load_map_size_y, temp_msg.effect, "game_board");
        }
        else {
            makeTable(temp_msg, load_map_size_x, load_map_size_y, 0, "game_board");
        }
    }
    if (game_result_msg) {
        game_result_display(game_result_msg, game_result_info);
    }
});
