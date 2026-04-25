let form = document.querySelector("form");
let chatArea = document.querySelector("#chat-area");
let inputMessage = document.querySelector("#message");

async function getBotAnswers() {
  const response = await fetch("ans.json");
  const data = await response.json();

  form.onsubmit = (e) => {
    e.preventDefault();

    let inputMessageS = inputMessage.value.trim().toLowerCase();

    if (inputMessageS === "") {
      alert("Please insert a value");
    } else {
      let found = false;
      let i = 0;

      while (i < data.intents.length && !found) {
        const intent = data.intents[i];
        let j = 0;

        while (j < intent.patterns.length && !found) {
          const pattern = intent.patterns[j];

          if (inputMessageS.includes(pattern.toLowerCase())) {
            chatArea.innerHTML += `<p class="msg">${inputMessageS}</p>`;

            const response = intent.responses[Math.floor(Math.random() * intent.responses.length)];

            setTimeout(() => {
              chatArea.innerHTML += `<p class="answer">${response}</p>`;
            }, Math.floor(Math.random() * 1000));

            found = true;
          }

          j++;
        }

        i++;
      }

      if (!found) {
        chatArea.innerHTML += `<p class="msg">${inputMessageS}</p>`;
        setTimeout(() => {
          chatArea.innerHTML += `<p class="answer">I'm sorry, but I didn't understand that or Contact our support.</p>`;
        }, Math.floor(Math.random() * 1000));
      }
    }

    inputMessage.value = "";
  };
}

getBotAnswers();



/*
let form = document.querySelector("form");
let chatArea = document.querySelector("#chat-area");
let inputMessage = document.querySelector("#message");

async function getBotAnswers() {
  const response = await fetch("ans.json");
  const data = await response.json();

  form.onsubmit = (e) => {
    e.preventDefault();

    let inputMessageS = inputMessage.value.trim().toLowerCase();

    if (inputMessageS === "") {
      alert("Please insert a value");
    } else {

      let found = false;
      data.intents.forEach((intent) => {
        intent.patterns.forEach((pattern) => {

          if (inputMessageS.includes(pattern.toLowerCase())) {

            chatArea.innerHTML += `<p class="msg">${inputMessageS}</p>`;

            const response = intent.responses[Math.floor(Math.random() * intent.responses.length)];

            setTimeout(() => {
              chatArea.innerHTML += `<p class="answer">${response}</p>`;
            },
              Math.floor(Math.random() * 1000));
            found = true;
          }
        });
      });

      if (!found) {
        chatArea.innerHTML += `<p class="msg">${inputMessageS}</p>`;
        setTimeout(() => {
          chatArea.innerHTML += `<p class="answer">I'm sorry, but I didn't understand that.</p>`;
        }, Math.floor(Math.random() * 1000));
      }
    }

    inputMessage.value = "";
  };
}

getBotAnswers()
*/
