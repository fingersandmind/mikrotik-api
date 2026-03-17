/**
 * Monkey-patch node-routeros Channel to handle !empty replies.
 *
 * RouterOS returns !empty for commands that match zero results or
 * write commands that produce no output. The !empty sentence is
 * followed by !done to close the command. node-routeros doesn't
 * handle !empty, causing an UNKNOWNREPLY exception.
 *
 * This patch simply ignores !empty and lets the subsequent !done
 * close the channel normally.
 */
const { Channel } = require('node-routeros/dist/Channel');

const originalProcessPacket = Channel.prototype.processPacket;

Channel.prototype.processPacket = function (packet) {
    // Ignore !empty replies — the !done that follows will close the channel
    if (packet.length > 0 && packet[0] === '!empty') {
        return;
    }
    return originalProcessPacket.call(this, packet);
};

console.log('Patched node-routeros: !empty replies are now ignored');
