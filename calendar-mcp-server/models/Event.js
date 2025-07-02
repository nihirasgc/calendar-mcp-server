import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema({
  list: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'List',
    required: false
  },
  calendarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Calendar', required: false },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  description: { type: String, default: '' },
  location: { type: String, default: '' },
  isAllDay: { type: Boolean, default: false },
  recurrenceRule: { type: String, default: '' },
  recurrenceExceptions: { type: [Date], default: [] },
  status: { type: String, enum: ['confirmed', 'tentative', 'cancelled'], default: 'confirmed' },
  tags: {
  type: [String],
  default: [],
  validate: {
    validator: (tags) => tags.every((tag) => ['work', 'personal'].includes(tag)),
    message: 'Invalid tag(s) provided',
  },
},
  attendees: { type: [String], default: [] }, // Array of user emails or IDs
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});


const Event = mongoose.model('Event', eventSchema);
export default Event;
