const inbox = document.getElementById('inbox');
const address = document.getElementById('emailAddress');
const createBtn = document.getElementById('createBtn');
const refreshBtn = document.getElementById('refreshBtn');

if (createBtn) {
createBtn.addEventListener('click', () => {
inbox.innerHTML = '<p>QuickInbox backend එක සම්බන්ධ කරන තුරු email inbox එක ක්‍රියා නොකරයි.</p>';
if (address) address.textContent = 'Backend configuration අවශ්‍යයි';
});
}

if (refreshBtn) {
refreshBtn.addEventListener('click', () => {
if (inbox) inbox.innerHTML = '<p>Inbox එක refresh කිරීමට backend එක සකස් කළ යුතුයි.</p>';
});
}
