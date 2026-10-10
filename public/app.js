
const emailBox = document.getElementById("email");
const inboxList = document.getElementById("inbox");
const refreshButton = document.getElementById("refresh");
const newButton = document.getElementById("new-email");

async function requestApi(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

async function createInbox() {
  try {
    newButton.disabled = true;
    inboxList.textContent = "Creating inbox...";

    const data = await requestApi("/api/inbox", {
      method: "POST",
      body: JSON.stringify({})
    });

    emailBox.textContent = data.email || "Inbox created";
    if (data.token) {
      sessionStorage.setItem("quickinbox_token", data.token);
    }

    await loadInbox();
  } catch (error) {
    inboxList.textContent = error.message;
  } finally {
    newButton.disabled = false;
  }
}

async function loadInbox() {
  const token = sessionStorage.getItem("quickinbox_token");

  if (!token) {
    inboxList.textContent = "Create a new inbox first.";
    return;
  }

  try {
    const data = await requestApi("/api/inbox", {
      headers: { Authorization: `Bearer ${token}` }
    });

    inboxList.replaceChildren();

    const messages = data.messages || [];

    if (!messages.length) {
      inboxList.textContent = "No emails yet. Check again soon.";
      return;
    }

    messages.forEach(message => {
      const item = document.createElement("article");
      const subject = document.createElement("h3");
      const sender = document.createElement("p");

      subject.textContent = message.subject || "(No subject)";
      sender.textContent = message.from || message.sender || "Unknown sender";

      item.append(subject, sender);
      inboxList.appendChild(item);
    });
  } catch (error) {
    inboxList.textContent = error.message;
  }
}

if (newButton) {
  newButton.addEventListener("click", createInbox);
}

if (refreshButton) {
  refreshButton.addEventListener("click", loadInbox);
}

loadInbox();
        
