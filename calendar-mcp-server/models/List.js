import mongoose from 'mongoose';

const listSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

const List = mongoose.model('List', listSchema);
export default List;
