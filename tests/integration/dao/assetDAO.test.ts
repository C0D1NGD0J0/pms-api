import { Types } from 'mongoose';
import { Asset } from '@models/index';
import { AssetDAO } from '@dao/assetDAO';
import {
  disconnectTestDatabase,
  clearTestDatabase,
  setupTestDatabase,
} from '@tests/helpers';

describe('AssetDAO Integration Tests', () => {
  let assetDAO: AssetDAO;
  let testUserId: string;
  let testPropertyId: string;

  beforeAll(async () => {
    await setupTestDatabase();
    assetDAO = new AssetDAO({ assetModel: Asset });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    testUserId = new Types.ObjectId().toString();
    testPropertyId = new Types.ObjectId().toString();
  });

  describe('createAsset', () => {
    it('should create a new asset with all required fields', async () => {
      const assetData = {
        resource: {
          name: 'User',
          id: testUserId,
        },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/avatar.jpg',
          filename: 'avatar_12345.jpg',
          key: 'users/avatar_12345.jpg',
        },
        type: 'image' as const,
        originalName: 'profile.jpg',
        uploadedBy: testUserId,
        fieldName: 'avatar',
        mimeType: 'image/jpeg',
        size: 102400,
        status: 'active' as const,
      };

      const asset = await assetDAO.createAsset(assetData);

      expect(asset).toBeDefined();
      expect(asset.resource.name).toBe('User');
      expect(asset.resource.id).toBe(testUserId);
      expect(asset.s3Info.key).toBe('users/avatar_12345.jpg');
      expect(asset.type).toBe('image');
      expect(asset.originalName).toBe('profile.jpg');
      expect(asset.size).toBe(102400);
    });

    it('should create document type asset', async () => {
      const assetData = {
        resource: {
          name: 'Property',
          id: testPropertyId,
        },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/lease.pdf',
          filename: 'lease_12345.pdf',
          key: 'properties/documents/lease_12345.pdf',
        },
        type: 'document' as const,
        originalName: 'lease_agreement.pdf',
        uploadedBy: testUserId,
        fieldName: 'documents',
        mimeType: 'application/pdf',
        size: 524288,
        status: 'active' as const,
      };

      const asset = await assetDAO.createAsset(assetData);

      expect(asset.type).toBe('document');
      expect(asset.mimeType).toBe('application/pdf');
      expect(asset.fieldName).toBe('documents');
    });

    it('should create video type asset', async () => {
      const assetData = {
        resource: {
          name: 'Property',
          id: testPropertyId,
        },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/tour.mp4',
          filename: 'tour_12345.mp4',
          key: 'properties/videos/tour_12345.mp4',
        },
        type: 'video' as const,
        originalName: 'property_tour.mp4',
        uploadedBy: testUserId,
        fieldName: 'videos',
        mimeType: 'video/mp4',
        size: 2097152,
        status: 'active' as const,
      };

      const asset = await assetDAO.createAsset(assetData);

      expect(asset.type).toBe('video');
      expect(asset.mimeType).toBe('video/mp4');
    });

    it('should throw error when required fields are missing', async () => {
      const invalidData = {
        resource: {
          name: 'User',
          id: testUserId,
        },
        type: 'image' as const,
      };

      await expect(assetDAO.createAsset(invalidData)).rejects.toThrow();
    });
  });

  describe('getAssetById', () => {
    it('should retrieve asset by id', async () => {
      const assetId = new Types.ObjectId();
      await Asset.create({
        _id: assetId,
        resource: {
          name: 'User',
          id: testUserId,
        },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/photo.jpg',
          filename: 'photo_12345.jpg',
          key: 'users/photo_12345.jpg',
        },
        type: 'image',
        originalName: 'photo.jpg',
        uploadedBy: testUserId,
        fieldName: 'avatar',
        mimeType: 'image/jpeg',
        size: 51200,
        status: 'active',
      });

      const asset = await assetDAO.getAssetById(assetId.toString());

      expect(asset).not.toBeNull();
      expect(asset?._id?.toString()).toBe(assetId.toString());
      expect(asset?.originalName).toBe('photo.jpg');
    });

    it('should return null for non-existent id', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const asset = await assetDAO.getAssetById(nonExistentId);

      expect(asset).toBeNull();
    });

    it('should not return deleted assets', async () => {
      const deletedId = new Types.ObjectId();
      await Asset.create({
        _id: deletedId,
        resource: {
          name: 'User',
          id: testUserId,
        },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/deleted.jpg',
          filename: 'deleted_12345.jpg',
          key: 'users/deleted_12345.jpg',
        },
        type: 'image',
        originalName: 'deleted.jpg',
        uploadedBy: testUserId,
        fieldName: 'avatar',
        mimeType: 'image/jpeg',
        size: 51200,
        status: 'deleted',
      });

      const asset = await assetDAO.getAssetById(deletedId.toString());

      expect(asset).toBeNull();
    });

    it('should throw error when id is missing', async () => {
      await expect(assetDAO.getAssetById('')).rejects.toThrow();
    });
  });

  describe('getAssetsByResource', () => {
    beforeEach(async () => {
      await Asset.insertMany([
        {
          resource: { name: 'User', id: testUserId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/avatar.jpg',
            filename: 'avatar_1.jpg',
            key: 'users/avatar_1.jpg',
          },
          type: 'image',
          originalName: 'avatar.jpg',
          uploadedBy: testUserId,
          fieldName: 'avatar',
          mimeType: 'image/jpeg',
          size: 51200,
          status: 'active',
        },
        {
          resource: { name: 'User', id: testUserId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/doc.pdf',
            filename: 'doc_1.pdf',
            key: 'users/doc_1.pdf',
          },
          type: 'document',
          originalName: 'document.pdf',
          uploadedBy: testUserId,
          fieldName: 'documents',
          mimeType: 'application/pdf',
          size: 102400,
          status: 'active',
        },
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/property.jpg',
            filename: 'property_1.jpg',
            key: 'properties/property_1.jpg',
          },
          type: 'image',
          originalName: 'property_photo.jpg',
          uploadedBy: testUserId,
          fieldName: 'photos',
          mimeType: 'image/jpeg',
          size: 204800,
          status: 'active',
        },
      ]);
    });

    it('should retrieve all assets for a specific resource', async () => {
      const result = await assetDAO.getAssetsByResource('User', testUserId);

      expect(result.items.length).toBe(2);
      expect(result.pagination?.total).toBe(2);
    });

    it('should retrieve assets for different resource type', async () => {
      const result = await assetDAO.getAssetsByResource('Property', testPropertyId);

      expect(result.items.length).toBe(1);
      expect(result.items[0].fieldName).toBe('photos');
    });

    it('should return empty array for resource with no assets', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const result = await assetDAO.getAssetsByResource('User', nonExistentId);

      expect(result.items.length).toBe(0);
      expect(result.pagination?.total).toBe(0);
    });

    it('should not return deleted assets', async () => {
      await Asset.create({
        resource: { name: 'User', id: testUserId },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/deleted.jpg',
          filename: 'deleted_1.jpg',
          key: 'users/deleted_1.jpg',
        },
        type: 'image',
        originalName: 'deleted.jpg',
        uploadedBy: testUserId,
        fieldName: 'avatar',
        mimeType: 'image/jpeg',
        size: 51200,
        status: 'deleted',
      });

      const result = await assetDAO.getAssetsByResource('User', testUserId);

      expect(result.items.length).toBe(2);
    });

    it('should support pagination options', async () => {
      const result = await assetDAO.getAssetsByResource('User', testUserId, {
        limit: 1,
        skip: 0,
      });

      expect(result.items.length).toBe(1);
      expect(result.pagination?.total).toBe(2);
    });
  });

  describe('getAssetsByFieldName', () => {
    beforeEach(async () => {
      await Asset.insertMany([
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/photo1.jpg',
            filename: 'photo1.jpg',
            key: 'properties/photos/photo1.jpg',
          },
          type: 'image',
          originalName: 'photo1.jpg',
          uploadedBy: testUserId,
          fieldName: 'photos',
          mimeType: 'image/jpeg',
          size: 102400,
          status: 'active',
        },
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/photo2.jpg',
            filename: 'photo2.jpg',
            key: 'properties/photos/photo2.jpg',
          },
          type: 'image',
          originalName: 'photo2.jpg',
          uploadedBy: testUserId,
          fieldName: 'photos',
          mimeType: 'image/jpeg',
          size: 102400,
          status: 'active',
        },
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/doc.pdf',
            filename: 'doc.pdf',
            key: 'properties/documents/doc.pdf',
          },
          type: 'document',
          originalName: 'document.pdf',
          uploadedBy: testUserId,
          fieldName: 'documents',
          mimeType: 'application/pdf',
          size: 204800,
          status: 'active',
        },
      ]);
    });

    it('should retrieve assets by field name', async () => {
      const assets = await assetDAO.getAssetsByFieldName(
        'Property',
        testPropertyId,
        'photos'
      );

      expect(assets.length).toBe(2);
      expect(assets.every((a) => a.fieldName === 'photos')).toBe(true);
    });

    it('should retrieve different field name', async () => {
      const assets = await assetDAO.getAssetsByFieldName(
        'Property',
        testPropertyId,
        'documents'
      );

      expect(assets.length).toBe(1);
      expect(assets[0].type).toBe('document');
    });

    it('should return empty array for non-existent field name', async () => {
      const assets = await assetDAO.getAssetsByFieldName(
        'Property',
        testPropertyId,
        'videos'
      );

      expect(assets.length).toBe(0);
    });

    it('should not return deleted assets for field name', async () => {
      await Asset.create({
        resource: { name: 'Property', id: testPropertyId },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/deleted.jpg',
          filename: 'deleted.jpg',
          key: 'properties/photos/deleted.jpg',
        },
        type: 'image',
        originalName: 'deleted.jpg',
        uploadedBy: testUserId,
        fieldName: 'photos',
        mimeType: 'image/jpeg',
        size: 102400,
        status: 'deleted',
      });

      const assets = await assetDAO.getAssetsByFieldName(
        'Property',
        testPropertyId,
        'photos'
      );

      expect(assets.length).toBe(2);
    });
  });

  describe('softDeleteAsset', () => {
    it('should soft delete an asset by setting status to deleted', async () => {
      const activeId = new Types.ObjectId();
      await Asset.create({
        _id: activeId,
        resource: { name: 'User', id: testUserId },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/photo.jpg',
          filename: 'photo.jpg',
          key: 'users/photo.jpg',
        },
        type: 'image',
        originalName: 'photo.jpg',
        uploadedBy: testUserId,
        fieldName: 'avatar',
        mimeType: 'image/jpeg',
        size: 51200,
        status: 'active',
      });

      const result = await assetDAO.softDeleteAsset(activeId.toString());

      expect(result).toBe(true);

      const asset = await Asset.findById(activeId).select('+deletedAt');
      expect(asset?.status).toBe('deleted');
      expect(asset?.deletedAt).toBeInstanceOf(Date);
    });

    it('should return true even if asset already deleted', async () => {
      const alreadyDeletedId = new Types.ObjectId();
      await Asset.create({
        _id: alreadyDeletedId,
        resource: { name: 'User', id: testUserId },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/photo.jpg',
          filename: 'photo.jpg',
          key: 'users/photo.jpg',
        },
        type: 'image',
        originalName: 'photo.jpg',
        uploadedBy: testUserId,
        fieldName: 'avatar',
        mimeType: 'image/jpeg',
        size: 51200,
        status: 'deleted',
      });

      const result = await assetDAO.softDeleteAsset(alreadyDeletedId.toString());

      expect(result).toBe(true);
    });

    it('should return false for non-existent asset id', async () => {
      const nonExistentId = new Types.ObjectId().toString();

      const result = await assetDAO.softDeleteAsset(nonExistentId);

      expect(result).toBe(false);
    });
  });

  describe('deleteAssetsByS3Keys', () => {
    beforeEach(async () => {
      await Asset.insertMany([
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/key1.jpg',
            filename: 'key1.jpg',
            key: 'properties/key1.jpg',
          },
          type: 'image',
          originalName: 'key1.jpg',
          uploadedBy: testUserId,
          fieldName: 'photos',
          mimeType: 'image/jpeg',
          size: 102400,
          status: 'active',
        },
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/key2.jpg',
            filename: 'key2.jpg',
            key: 'properties/key2.jpg',
          },
          type: 'image',
          originalName: 'key2.jpg',
          uploadedBy: testUserId,
          fieldName: 'photos',
          mimeType: 'image/jpeg',
          size: 102400,
          status: 'active',
        },
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/key3.jpg',
            filename: 'key3.jpg',
            key: 'properties/key3.jpg',
          },
          type: 'image',
          originalName: 'key3.jpg',
          uploadedBy: testUserId,
          fieldName: 'photos',
          mimeType: 'image/jpeg',
          size: 102400,
          status: 'active',
        },
      ]);
    });

    it('should delete multiple assets by S3 keys', async () => {
      const result = await assetDAO.deleteAssetsByS3Keys([
        'properties/key1.jpg',
        'properties/key2.jpg',
      ]);

      expect(result).toBe(true);

      const deletedAssets = await Asset.find({
        's3Info.key': { $in: ['properties/key1.jpg', 'properties/key2.jpg'] },
      }).select('+deletedAt');

      expect(deletedAssets.every((a) => a.status === 'deleted')).toBe(true);
      expect(deletedAssets.every((a) => a.deletedAt)).toBe(true);
    });

    it('should delete single asset by S3 key', async () => {
      const result = await assetDAO.deleteAssetsByS3Keys(['properties/key1.jpg']);

      expect(result).toBe(true);

      const asset = await Asset.findOne({ 's3Info.key': 'properties/key1.jpg' });
      expect(asset?.status).toBe('deleted');
    });

    it('should return true for empty array', async () => {
      const result = await assetDAO.deleteAssetsByS3Keys([]);

      expect(result).toBe(true);
    });

    it('should return true for non-existent S3 keys', async () => {
      const result = await assetDAO.deleteAssetsByS3Keys(['non/existent/key.jpg']);

      expect(result).toBe(true);
    });

    it('should not affect assets with different S3 keys', async () => {
      await assetDAO.deleteAssetsByS3Keys(['properties/key1.jpg']);

      const untouchedAsset = await Asset.findOne({ 's3Info.key': 'properties/key3.jpg' });
      expect(untouchedAsset?.status).toBe('active');
    });
  });

  describe('getAssetStats', () => {
    beforeEach(async () => {
      await Asset.insertMany([
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/photo1.jpg',
            filename: 'photo1.jpg',
            key: 'properties/photo1.jpg',
          },
          type: 'image',
          originalName: 'photo1.jpg',
          uploadedBy: testUserId,
          fieldName: 'photos',
          mimeType: 'image/jpeg',
          size: 102400,
          status: 'active',
        },
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/photo2.jpg',
            filename: 'photo2.jpg',
            key: 'properties/photo2.jpg',
          },
          type: 'image',
          originalName: 'photo2.jpg',
          uploadedBy: testUserId,
          fieldName: 'photos',
          mimeType: 'image/jpeg',
          size: 204800,
          status: 'active',
        },
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/doc.pdf',
            filename: 'doc.pdf',
            key: 'properties/doc.pdf',
          },
          type: 'document',
          originalName: 'document.pdf',
          uploadedBy: testUserId,
          fieldName: 'documents',
          mimeType: 'application/pdf',
          size: 524288,
          status: 'active',
        },
        {
          resource: { name: 'Property', id: testPropertyId },
          s3Info: {
            url: 'https://s3.amazonaws.com/bucket/video.mp4',
            filename: 'video.mp4',
            key: 'properties/video.mp4',
          },
          type: 'video',
          originalName: 'video.mp4',
          uploadedBy: testUserId,
          fieldName: 'videos',
          mimeType: 'video/mp4',
          size: 2097152,
          status: 'active',
        },
      ]);
    });

    it('should calculate total assets and size for resource', async () => {
      const stats = await assetDAO.getAssetStats('Property', testPropertyId);

      expect(stats.totalAssets).toBe(4);
      expect(stats.totalSize).toBe(102400 + 204800 + 524288 + 2097152);
    });

    it('should group assets by type', async () => {
      const stats = await assetDAO.getAssetStats('Property', testPropertyId);

      expect(stats.assetsByType.image).toBe(2);
      expect(stats.assetsByType.document).toBe(1);
      expect(stats.assetsByType.video).toBe(1);
    });

    it('should return zero stats for resource with no assets', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const stats = await assetDAO.getAssetStats('Property', nonExistentId);

      expect(stats.totalAssets).toBe(0);
      expect(stats.totalSize).toBe(0);
      expect(Object.keys(stats.assetsByType).length).toBe(0);
    });

    it('should exclude deleted assets from stats', async () => {
      await Asset.create({
        resource: { name: 'Property', id: testPropertyId },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/deleted.jpg',
          filename: 'deleted.jpg',
          key: 'properties/deleted.jpg',
        },
        type: 'image',
        originalName: 'deleted.jpg',
        uploadedBy: testUserId,
        fieldName: 'photos',
        mimeType: 'image/jpeg',
        size: 999999,
        status: 'deleted',
      });

      const stats = await assetDAO.getAssetStats('Property', testPropertyId);

      expect(stats.totalAssets).toBe(4);
      expect(stats.totalSize).not.toContain(999999);
    });

    it('should return stats for different resource types', async () => {
      await Asset.create({
        resource: { name: 'User', id: testUserId },
        s3Info: {
          url: 'https://s3.amazonaws.com/bucket/avatar.jpg',
          filename: 'avatar.jpg',
          key: 'users/avatar.jpg',
        },
        type: 'image',
        originalName: 'avatar.jpg',
        uploadedBy: testUserId,
        fieldName: 'avatar',
        mimeType: 'image/jpeg',
        size: 51200,
        status: 'active',
      });

      const propertyStats = await assetDAO.getAssetStats('Property', testPropertyId);
      const userStats = await assetDAO.getAssetStats('User', testUserId);

      expect(propertyStats.totalAssets).toBe(4);
      expect(userStats.totalAssets).toBe(1);
      expect(userStats.totalSize).toBe(51200);
    });
  });
});
