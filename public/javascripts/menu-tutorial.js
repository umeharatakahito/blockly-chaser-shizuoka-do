function createStageList(get_list) {
  // ステージ名でグルーピング
  const groupMap = {};
  for (const key in get_list) {
    const stage = get_list[key];
    let groupName = stage.name;
    const match = groupName.match(/^(ステージ\s*\d+)/);
    if (match) {
      groupName = match[1];
    }
    if (!groupMap[groupName]) {
      groupMap[groupName] = [];
    }
    groupMap[groupName].push(stage);
  }

  const stageListElem = document.getElementById('stage_list');
  stageListElem.innerHTML = '';

  // ステージ名でソート
  Object.keys(groupMap)
    .sort((a, b) => {
      const aMatch = a.match(/(\d+)/);
      const bMatch = b.match(/(\d+)/);
      if (aMatch && bMatch) {
        return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
      }
      return a.localeCompare(b, 'ja', {numeric: true});
    })
    .forEach((groupName, groupIdx) => {
      const groupDiv = document.createElement('div');
      groupDiv.classList.add('stage_group');

      const groupTitle = document.createElement('div');
      groupTitle.classList.add('stage_group_title');
      groupTitle.textContent = groupName;
      groupDiv.appendChild(groupTitle);

      const rowDiv = document.createElement('div');
      rowDiv.classList.add('stage_row');

      // ステージ番号でソート
      groupMap[groupName].sort((a, b) => {
        const aMatch = a.name.match(/-(\d+)$/);
        const bMatch = b.name.match(/-(\d+)$/);
        if (aMatch && bMatch) {
          return parseInt(aMatch[1], 10) - parseInt(bMatch[1], 10);
        }
        return a.name.localeCompare(b.name, 'ja', {numeric: true});
      });

      groupMap[groupName].forEach((stage, i) => {
        const one_stage = document.createElement('div');
        one_stage.classList.add("one_stage");
        one_stage.setAttribute("id", "link_id_" + stage.stage_id);

        const level = stage.level || false;

        const stage_div = document.createElement('div');
        stage_div.classList.add(stage.stage_id);
        stage_div.classList.add("stage_div");

        const stage_level = document.createElement('div');
        if (level) {
          stage_level.classList.add("stage_level");
        }
        let newContent = document.createTextNode("Level " + level);
        stage_level.appendChild(newContent);

        const stage_clear = document.createElement('div');
        stage_clear.classList.add("stage_status");
        if (localStorage[stage.stage_id]) {
          stage_clear.classList.add("stage_clear");
        }

        const stage_name = document.createElement('div');
        stage_name.classList.add("stage_name");
        newContent = document.createTextNode(stage.name);
        stage_name.appendChild(newContent);

        const stage_info = document.createElement('div');
        stage_info.classList.add("stage_info");
        if (stage.info) {
          newContent = document.createTextNode(stage.info);
        } else {
          newContent = document.createTextNode("");
        }
        stage_info.appendChild(newContent);

        stage_div.appendChild(stage_level);
        stage_div.appendChild(stage_clear);
        stage_div.appendChild(stage_name);
        stage_div.appendChild(stage_info);

        stage_div.onclick = function (e) {
          var stageId = this.classList[0];
          document.querySelectorAll('.stage_div').forEach(div => {
            div.classList.remove("stage_select_on");
          });
          this.classList.add("stage_select_on");
          stage_info_create(stageId, get_list);
          e.stopPropagation();
        };

        one_stage.appendChild(stage_div);
        rowDiv.appendChild(one_stage);
      });

      groupDiv.appendChild(rowDiv);
      stageListElem.appendChild(groupDiv);
    });
}

function stage_info_create(id, get_list) {

  var data = get_list[id].map_data;
  var c = document.getElementById("map_table");
  if (c) {
    c.parentNode.removeChild(c);
  }
  var rows = [];
  var table = document.createElement("table");
  table.setAttribute("id", "map_table");

  for (i = 0; i < data.length; i++) {
    rows.push(table.insertRow(-1));
    for (j = 0; j < data[0].length; j++) {
      cell = rows[i].insertCell(-1);
      if (data[i][j] == 0) {
        cell.classList.add("field_img");
      }
      else if (data[i][j] == 1) {
        cell.classList.add("wall_img");
      }
      else if (data[i][j] == 2) {
        cell.classList.add("hart_img");
      }
      else if (data[i][j] == 3) {
        cell.classList.add("cool_img");
      }
      else if (data[i][j] == 4) {
        cell.classList.add("hot_img");
      }
      else if (data[i][j] == 34) {
        cell.classList.add("ch_img");
      }
      else if (data[i][j] == 43) {
        cell.classList.add("hc_img");
      }
    }
  }

  c = document.getElementById("stage_join_div");
  if (c) {
    c.parentNode.removeChild(c);
  }



  document.getElementById("stage_info_name").textContent = get_list[id].name;

  if (get_list[id].mode == "gethart") {
    document.getElementById("stage_info_hart_data").textContent = get_list[id].get_hart_value;
    if (document.getElementById("stage_info_hart").classList.contains('display_off')) {
      document.getElementById("stage_info_hart").classList.remove("display_off");
    }

    if (!document.getElementById("stage_info_put").classList.contains('display_off')) {
      document.getElementById("stage_info_put").classList.add("display_off");
    }
  }
  else if (get_list[id].mode == "puthot") {
    if (document.getElementById("stage_info_put").classList.contains('display_off')) {
      document.getElementById("stage_info_put").classList.remove("display_off");
    }

    if (!document.getElementById("stage_info_hart").classList.contains('display_off')) {
      document.getElementById("stage_info_hart").classList.add("display_off");
    }
  }
  document.getElementById("stage_info_block_data").textContent = get_list[id].block_limit;
  document.getElementById("stage_info_turn_data").textContent = get_list[id].turn;




  var stage_join_div = document.createElement('div');
  stage_join_div.setAttribute("id", "stage_join_div");

  var stage_join_link = document.createElement('a');
  stage_join_link.classList.add("stage_join_link");
  stage_join_link.href = "/tutorial?stage=" + id;
  //server_join_link.target = "_blank";
  stage_join_link.innerText = "はじめる";

  stage_join_div.appendChild(stage_join_link);


  document.getElementById("stage_info").prepend(stage_join_div);
  document.getElementById("stage_map").appendChild(table);

  document.getElementById("stage_map").classList.remove("display_off");
  document.getElementById("stage_info_condition").classList.remove("display_off");
  document.getElementById("stage_join_div").classList.remove("display_off");
  document.getElementById("stage_info_name").classList.remove("display_off");
  document.getElementById("menu_area").classList.add("select_back");
}


window.addEventListener('load', function () {
  getStageList();
})

function getStageList() {
  var url = './../api/tutorial';
  fetch(url)
    .then(function (data) {
      return data.json();
    })
    .then(function (json) {
      createStageList(json);
    });
}

document.getElementById("menu_area").onclick = function () {
  document.getElementById("stage_map").classList.add("display_off");
  document.getElementById("stage_info_condition").classList.add("display_off");
  document.getElementById("stage_join_div").classList.add("display_off");
  document.getElementById("stage_info_name").classList.add("display_off");
  document.getElementById("menu_area").classList.remove("select_back");
}

document.getElementById("stage_info").onclick = function (e) {
  e.stopPropagation();
}

document.getElementById("stage_info_name").onclick = function (e) {
  e.stopPropagation();
}